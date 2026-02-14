'use strict';

const EventEmitter = require('events');
const dgram = require('dgram');

const debug = require('debug');

const Packet = require('./packet');
const tokens = require('./tokens');

const safeishJSON = require('./safeishJSON');

const PORT = 54321;
const HANDSHAKE_TIMEOUT = 5000;
const CALL_TIMEOUT = 2000;
const RETRY_BASE_DELAY = 1000;
const RETRY_MAX_DELAY = 8000;
const TRANSIENT_NETWORK_ERRORS = new Set([
	'EHOSTUNREACH',
	'EHOSTDOWN',
	'ENETUNREACH',
	'ENETDOWN',
	'ENETRESET',
	'EAGAIN',
	'EWOULDBLOCK',
	'ENOBUFS',
	'ENOTCONN',
	'EADDRNOTAVAIL',
	'ECONNREFUSED',
	'ECONNRESET',
	'EPIPE',
	'ETIMEDOUT',
	'EAI_AGAIN',
	'EAI_FAIL',
	'EAI_NONAME',
	'EAI_NODATA',
	'ENOTFOUND',
	'ERR_SOCKET_DGRAM_NOT_RUNNING'
]);
const RETRYABLE_DEVICE_ERROR_CODES = new Set([
	'-9999',
	'-30001'
]);
const RETRYABLE_DEVICE_ERROR_MESSAGES = [
	'invalid stamp',
	'invalid_stmp'
];

const ERRORS = {
	'-5001': (method, args, err) =>
		err.message === 'invalid_arg' ? 'Invalid argument' : err.message,
	'-5005': (method, args, err) =>
		err.message === 'params error' ? 'Invalid argument' : err.message,
	'-10000': method => 'Method `' + method + '` is not supported'
};

/**
 * Class for keeping track of the current network of devices. This is used to
 * track a few things:
 *
 * 1) Mapping between adresses and device identifiers. Used when connecting to
 * a device directly via IP or hostname.
 *
 * 2) Mapping between id and detailed device info such as the model.
 *
 */
class Network extends EventEmitter {
	constructor() {
		super();

		this.packet = new Packet(true);

		this.addresses = new Map();
		this.devices = new Map();

		this.references = 0;
		this.debug = debug('miio:network');
		this._socketResetInProgress = false;
	}

	resetSocket(reason) {
		if (this._socketResetInProgress) return;

		this._socketResetInProgress = true;
		this.debug('Resetting network socket due to', reason || 'unknown reason');

		if (this._socket) {
			try {
				this._socket.close();
			} catch (err) {
				this.debug('Failed to close network socket during reset', err);
				this._socket = null;
			}
		}

		setTimeout(() => {
			this._socketResetInProgress = false;

			if (this.references > 0 && !this._socket) {
				this.createSocket();
			}
		}, 250);
	}

	search() {
		this.packet.handshake();
		const data = Buffer.from(this.packet.raw);

		const sendBroadcast = () => {
			let socket;
			try {
				socket = this.socket;
			} catch (err) {
				if (TRANSIENT_NETWORK_ERRORS.has(err.code)) {
					this.debug('Skipping discovery broadcast due to transient network issue', err.code);
					return;
				}

				throw err;
			}

			socket.send(data, 0, data.length, PORT, '255.255.255.255', err => {
				if (!err) return;

				if (TRANSIENT_NETWORK_ERRORS.has(err.code)) {
					this.debug('Discovery broadcast failed due to transient network issue', err.code);
					this.resetSocket('discovery broadcast error: ' + err.code);
					return;
				}

				this.debug('Discovery broadcast failed', err);
			});
		};

		sendBroadcast();

		// Broadcast an extra time in 500 milliseconds in case the first brodcast misses a few devices
		setTimeout(() => {
			sendBroadcast();
		}, 500);
	}

	findDevice(id, rinfo) {
		// First step, check if we know about the device based on id
		let device = this.devices.get(id);
		if (!device && rinfo) {
			// If we have info about the address, try to resolve again
			device = this.addresses.get(rinfo.address);

			if (!device) {
				// No device found, keep track of this one
				device = new DeviceInfo(this, id, rinfo.address, rinfo.port);
			}
		}

		if (!device) return null;

		if (device.id !== id) {
			if (device.id && this.devices.get(device.id) === device) {
				this.devices.delete(device.id);
			}

			device.id = id;
			device.debug = debug('thing:miio:' + id);
			device.debug('Identifier of device updated');
		}

		if (rinfo) {
			if (device.address !== rinfo.address) {
				if (device.address && this.addresses.get(device.address) === device) {
					this.addresses.delete(device.address);
				}

				device.address = rinfo.address;
				this.addresses.set(rinfo.address, device);
			}

			if (device.port !== rinfo.port) {
				device.port = rinfo.port;
			}
		}

		this.devices.set(id, device);

		return device;
	}

	findDeviceViaAddress(options) {
		if (!this.socket) {
			throw new Error(
				'Implementation issue: Using network without a reference'
			);
		}

		let device = this.addresses.get(options.address);
		if (!device) {
			// No device was found at the address, try to discover it
			device = new DeviceInfo(
				this,
				null,
				options.address,
				options.port || PORT
			);
			this.addresses.set(options.address, device);
		}

		// Update the token if we have one
		if (typeof options.token === 'string') {
			device.token = Buffer.from(options.token, 'hex');
		} else if (options.token instanceof Buffer) {
			device.token = options.token;
		}

		// Set the model if provided
		if (!device.model && options.model) {
			device.model = options.model;
		}

		// Perform a handshake with the device to see if we can connect
		return device
			.handshake()
			.catch(err => {
				if (err.code === 'missing-token') {
					// Supress missing tokens - enrich should take care of that
					return;
				}

				throw err;
			})
			.then(() => {
				if (!this.devices.has(device.id)) {
					// This is a new device, keep track of it
					this.devices.set(device.id, device);

					return device;
				} else {
					// Sanity, make sure that the device in the map is returned
					return this.devices.get(device.id);
				}
			})
			.then(device => {
				/*
				 * After the handshake, call enrich which will fetch extra
				 * information such as the model. It will also try to check
				 * if the provided token (or the auto-token) works correctly.
				 */
				return device.enrich();
			})
			.then(() => device);
	}

	createSocket() {
		this._socket = dgram.createSocket('udp4');
		const socket = this._socket;

		// Bind the socket and when it is ready mark it for broadcasting
		socket.bind();
		socket.on('listening', () => {
			socket.setBroadcast(true);

			const address = socket.address();
			this.debug('Network bound to port', address.port);
		});

		socket.on('error', err => {
			this.debug('Network socket error', err);

			if (err && TRANSIENT_NETWORK_ERRORS.has(err.code)) {
				this.resetSocket('socket error event: ' + err.code);
			}
		});

		socket.on('close', () => {
			this.debug('Network socket closed');

			if (this._socket === socket) {
				this._socket = null;
			}

			if (this.references > 0 && !this._socket) {
				this.debug('Network still referenced, recreating socket');
				setTimeout(() => {
					if (this.references > 0 && !this._socket) {
						this.createSocket();
					}
				}, 1000);
			}
		});

		// On any incoming message, parse it, update the discovery
		this._socket.on('message', (msg, rinfo) => {
			const buf = Buffer.from(msg);
			try {
				this.packet.raw = buf;
			} catch (ex) {
				this.debug('Could not handle incoming message');
				return;
			}

			if (!this.packet.deviceId) {
				this.debug('No device identifier in incoming packet');
				return;
			}

			const device = this.findDevice(this.packet.deviceId, rinfo);
			device.onMessage(buf);

			if (!this.packet.data) {
				if (!device.enriched) {
					// This is the first time we see this device
					Promise.resolve()
						.then(() => device.enrich())
						.then(() => {
							this.emit('device', device);
						})
						.catch(err => {
							this.emit('device', device);
						});
				} else {
					this.emit('device', device);
				}
			}
		});
	}

	list() {
		return this.devices.values();
	}

	/**
	 * Get a reference to the network. Helps with locking of a socket.
	 */
	ref() {
		this.debug('Grabbing reference to network');
		this.references++;
		this.updateSocket();

		let released = false;
		let self = this;
		return {
			release() {
				if (released) return;

				self.debug('Releasing reference to network');

				released = true;
				self.references--;

				self.updateSocket();
			}
		};
	}

	/**
	 * Update wether the socket is available or not. Instead of always keeping
	 * a socket we track if it is available to allow Node to exit if no
	 * discovery or device is being used.
	 */
	updateSocket() {
		if (this.references === 0) {
			// No more references, kill the socket
			if (this._socket) {
				this.debug('Network no longer active, destroying socket');
				this._socket.close();
				this._socket = null;
			}
		} else if (this.references === 1 && !this._socket) {
			// This is the first reference, create the socket
			this.debug('Making network active, creating socket');
			this.createSocket();
		}
	}

	get socket() {
		if (!this._socket) {
			const err = new Error(
				'Network communication is unavailable, device might be destroyed'
			);
			err.code = 'ENOTCONN';
			throw err;
		}

		return this._socket;
	}
}

module.exports = new Network();

class DeviceInfo {
	constructor(parent, id, address, port) {
		this.parent = parent;
		this.packet = new Packet();

		this.address = address;
		this.port = port;

		// Tracker for all promises associated with this device
		this.promises = new Map();
		this.lastId = 0;

		this.id = id;
		this.debug = id ? debug('thing:miio:' + id) : debug('thing:miio:pending');

		// Get if the token has been manually changed
		this.tokenChanged = false;
	}

	get token() {
		return this.packet.token;
	}

	set token(t) {
		this.debug('Using manual token:', t.toString('hex'));
		this.packet.token = t;
		this.tokenChanged = true;
	}

	/**
	 * Enrich this device with detailed information about the model. This will
	 * simply call miIO.info.
	 */
	enrich() {
		if (!this.id) {
			throw new Error('Device has no identifier yet, handshake needed');
		}

		if (this.model && !this.tokenChanged && this.packet.token) {
			// This device has model info and a valid token
			return Promise.resolve();
		}

		if (this.enrichPromise) {
			// If enrichment is already happening
			return this.enrichPromise;
		}

		// Check if there is a token available, otherwise try to resolve it
		let promise;
		if (!this.packet.token) {
			// No automatic token found - see if we have a stored one
			this.debug(
				'Loading token from storage, device hides token and no token set via options'
			);
			this.autoToken = false;
			promise = tokens.get(this.id).then(token => {
				this.debug('Using stored token:', token);
				this.packet.token = Buffer.from(token, 'hex');
				this.tokenChanged = true;
			});
		} else {
			if (this.tokenChanged) {
				this.autoToken = false;
			} else {
				this.autoToken = true;
				this.debug('Using automatic token:', this.packet.token.toString('hex'));
			}
			promise = Promise.resolve();
		}

		return (this.enrichPromise = promise
			.then(() => this.call('miIO.info'))
			.then(data => {
				this.enriched = true;
				this.model = data.model;
				this.tokenChanged = false;

				this.enrichPromise = null;
			})
			.catch(err => {
				this.enrichPromise = null;
				this.enriched = false;

				if (err.code === 'missing-token') {
					// Rethrow some errors
					err.device = this;
					throw err;
				}

				if (this.packet.token) {
					// Could not call the info method, this might be either a timeout or a token problem
					const e = new Error(
						'Could not connect to device, token might be wrong'
					);
					e.code = 'connection-failure';
					e.device = this;
					throw e;
				} else {
					const e = new Error(
						'Could not connect to device, token needs to be specified'
					);
					e.code = 'missing-token';
					e.device = this;
					throw e;
				}
			}));
	}

	onMessage(msg) {
		try {
			this.packet.raw = msg;
		} catch (ex) {
			this.debug('<- Unable to parse packet', ex);
			return;
		}

		let data = this.packet.data;
		if (data === null) {
			this.debug('<-', 'Handshake reply:', this.packet.checksum);
			this.packet.handleHandshakeReply();

			if (this.handshakeResolve) {
				this.handshakeResolve();
			}
		} else {
			// Handle null-terminated strings
			if (data[data.length - 1] === 0) {
				data = data.slice(0, data.length - 1);
			}

			// Parse and handle the JSON message
			let str = data.toString('utf8');

			// Remove non-printable characters to help with invalid JSON from devices
			str = str.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, ''); // eslint-disable-line

			this.debug('<- Message: `' + str + '`');
			try {
				let object = safeishJSON(str);

				const p = this.promises.get(object.id);
				if (!p) return;
				if (typeof object.result !== 'undefined') {
					p.resolve(object.result);
				} else {
					if (this._isRetryableDeviceError(object.error) && typeof p.retry === 'function') {
						p.retry(object.error);
					} else {
						p.reject(object.error);
					}
				}
			} catch (ex) {
				this.debug('<- Invalid JSON', ex);
			}
		}
	}

	_isRetryableDeviceError(err) {
		if (!err) return false;

		if (RETRYABLE_DEVICE_ERROR_CODES.has(String(err.code))) {
			return true;
		}

		if (typeof err.message !== 'string') {
			return false;
		}

		const message = err.message.toLowerCase();
		return RETRYABLE_DEVICE_ERROR_MESSAGES.some(part => message.includes(part));
	}

		handshake() {
		if (!this.packet.needsHandshake) {
			return Promise.resolve(this.token);
		}

		// If a handshake is already in progress use it
		if (this.handshakePromise) {
			return this.handshakePromise;
		}

		return (this.handshakePromise = new Promise((resolve, reject) => {
			const cleanup = () => {
				if (this.handshakeTimeout) {
					clearTimeout(this.handshakeTimeout);
				}

				this.handshakeResolve = null;
				this.handshakeTimeout = null;
				this.handshakePromise = null;
			};

			let done = false;
			const fail = err => {
				if (done) return;
				done = true;
				cleanup();
				reject(err);
			};

			const succeed = () => {
				if (done) return;
				done = true;
				cleanup();
				resolve();
			};

			// Create and send the handshake data
			this.packet.handshake();
			const data = this.packet.raw;
			try {
				this.parent.socket.send(data, 0, data.length, this.port, this.address, err => {
					if (err) {
						fail(err);
					}
				});
			} catch (err) {
				fail(err);
			}

			// Handler called when a reply to the handshake is received
			this.handshakeResolve = () => {
				if (this.id !== this.packet.deviceId) {
					// Update the identifier if needed
					this.id = this.packet.deviceId;
					this.debug = debug('thing:miio:' + this.id);
					this.debug('Identifier of device updated');
				}

				if (this.packet.token) {
					succeed();
				} else {
					const err = new Error(
						'Could not connect to device, token needs to be specified'
					);
					err.code = 'missing-token';
					fail(err);
				}
			};

			// Timeout for the handshake
			this.handshakeTimeout = setTimeout(() => {
				const err = new Error('Could not connect to device, handshake timeout');
				err.code = 'timeout';
				fail(err);
			}, HANDSHAKE_TIMEOUT);
		}));
	}

	call(method, args, options) {
		if (typeof args === 'undefined') {
			args = [];
		}

		const request = {
			method: method,
			params: args
		};

		if (options && options.sid) {
			// If we have a sub-device set it (used by Lumi Smart Home Gateway)
			request.sid = options.sid;
		}

		return new Promise((resolve, reject) => {
			let resolved = false;
			let responseTimeout = null;

			const normalizeNetworkError = err => {
				if (!err || err.code) return err;

				if (typeof err.message === 'string' && err.message.includes('Network communication is unavailable')) {
					err.code = 'ENOTCONN';
				}

				return err;
			};

			const isRetryableNetworkError = err => {
				err = normalizeNetworkError(err);
				return !!(err && TRANSIENT_NETWORK_ERRORS.has(err.code));
			};

			const recoverFromNetworkError = reason => {
				this.parent.resetSocket(reason);
			};

			// Handler for incoming messages
			const promise = {
				resolve: res => {
					resolved = true;
					if (responseTimeout) {
						clearTimeout(responseTimeout);
						responseTimeout = null;
					}
					this.promises.delete(request.id);

					resolve(res);
				},
				reject: err => {
					resolved = true;
					if (responseTimeout) {
						clearTimeout(responseTimeout);
						responseTimeout = null;
					}
					this.promises.delete(request.id);

					if (!(err instanceof Error) && typeof err.code !== 'undefined') {
						const code = err.code;

						const handler = ERRORS[code];
						let msg;
						if (handler) {
							msg = handler(method, args, err.message);
						} else {
							msg = err.message || err.toString();
						}

						err = new Error(msg);
						err.code = code;
					}
					reject(err);
				},
				retry: err => {
					this.debug('<- Retryable device error received', err);
					retry('device requested re-handshake');
				}
			};

			let retriesLeft = (options && options.retries) || 5;
			let retryAttempt = 0;
			const getRetryDelay = () => {
				const exponential = RETRY_BASE_DELAY * Math.pow(2, retryAttempt);
				const baseDelay = Math.min(exponential, RETRY_MAX_DELAY);
				const jitter = Math.floor(Math.random() * RETRY_BASE_DELAY);
				return baseDelay + jitter;
			};

			const retry = reason => {
				if (resolved) return;

				if (responseTimeout) {
					clearTimeout(responseTimeout);
					responseTimeout = null;
				}

				if (request.id) {
					this.promises.delete(request.id);
				}

				// Any retry means we no longer trust the server stamp for this session
				this.packet.markHandshakeRequired();

				if (retriesLeft-- > 0) {
					const delay = getRetryDelay();
					this.debug('<- Retrying call in', delay, 'ms due to', reason);
					retryAttempt++;
					setTimeout(send, delay);
				} else {
					this.debug('Reached maximum number of retries, giving up');
					const err = new Error('Call to device timed out');
					err.code = 'timeout';
					promise.reject(err);
				}
			};

			const send = () => {
				if (resolved) return;
				let retryScheduled = false;
				const retryOnce = reason => {
					if (retryScheduled || resolved) return;
					retryScheduled = true;
					retry(reason);
				};

				this.handshake()
					.catch(err => {
						normalizeNetworkError(err);

						if (err.code === 'timeout') {
							this.debug('<- Handshake timed out');
							retryOnce('handshake timeout');
							return false;
						}

						if (isRetryableNetworkError(err)) {
							this.debug('<- Handshake network error', err.code);
							recoverFromNetworkError('handshake network error: ' + err.code);
							retryOnce('handshake network error: ' + err.code);
							return false;
						}

						throw err;
					})
					.then(token => {
						// Token has timed out - handled via retry
						if (!token) return;

						// Assign the identifier before each send
						let id;
						if (request.id) {
							/*
							 * This is a failure, increase the last id. Should
							 * increase the chances of the new request to
							 * succeed. Related to issues with the vacuum
							 * not responding such as described in issue #94.
							 */
							id = this.lastId + 100;

							// Make sure to remove the failed promise
							this.promises.delete(request.id);
						} else {
							id = this.lastId + 1;
						}

						// Check that the id hasn't rolled over
						if (id >= 10000) {
							this.lastId = id = 1;
						} else {
							this.lastId = id;
						}

						// Assign the identifier
						request.id = id;

						// Store reference to the promise so reply can be received
						this.promises.set(id, promise);

						// Create the JSON and send it
						const json = JSON.stringify(request);
						this.debug('-> (' + retriesLeft + ')', json);
						this.packet.data = Buffer.from(json, 'utf8');

						const data = this.packet.raw;

						try {
							this.parent.socket.send(
								data,
								0,
								data.length,
								this.port,
								this.address,
								err => {
									if (!err) return;

									if (isRetryableNetworkError(err)) {
										recoverFromNetworkError('socket send error: ' + err.code);
										retryOnce('socket send error: ' + err.code);
										return;
									}

									promise.reject(err);
								}
							);
						} catch (err) {
							if (isRetryableNetworkError(err)) {
								recoverFromNetworkError('socket send throw: ' + err.code);
								retryOnce('socket send throw: ' + err.code);
								return;
							}

							throw err;
						}

						// Queue retry if no response is received
						responseTimeout = setTimeout(() => {
							retryOnce('call timeout');
						}, CALL_TIMEOUT);
					})
					.catch(promise.reject);
			};

			send();
		});
	}
}
