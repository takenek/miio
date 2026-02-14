'use strict';

const network = require('./network');

const Device = require('./device');
const Placeholder = require('./placeholder');
const models = require('./models');

const TRANSIENT_CONNECTION_ERROR_CODES = new Set([
	'timeout',
	'ENOTCONN',
	'EHOSTUNREACH',
	'EHOSTDOWN',
	'ENETUNREACH',
	'ENETDOWN',
	'ENETRESET',
	'EAGAIN',
	'EWOULDBLOCK',
	'ENOBUFS',
	'EADDRNOTAVAIL',
	'ECONNREFUSED',
	'ECONNRESET',
	'EPIPE',
	'EBADF',
	'EIO',
	'ECANCELED',
	'ETIMEDOUT',
	'EAI_AGAIN',
	'EAI_FAIL',
	'EAI_SYSTEM',
	'EAI_NONAME',
	'EAI_NODATA',
	'ENOTFOUND',
	'ERR_SOCKET_DGRAM_NOT_RUNNING',
	'ERR_SOCKET_CLOSED',
	'connection-failure'
]);

const RETRY_BASE_DELAY = 1000;
const RETRY_MAX_DELAY = 8000;

function isTransientConnectionError(error) {
	if(! error) return false;

	if(TRANSIENT_CONNECTION_ERROR_CODES.has(error.code)) {
		return true;
	}

	return typeof error.message === 'string' && error.message.includes('Network communication is unavailable');
}

function getRetryDelay(attempt) {
	const exponential = RETRY_BASE_DELAY * Math.pow(2, attempt);
	const baseDelay = Math.min(exponential, RETRY_MAX_DELAY);
	const jitter = Math.floor(Math.random() * RETRY_BASE_DELAY);
	return baseDelay + jitter;
}

function wait(ms) {
	return new Promise(resolve => {
		const timer = setTimeout(resolve, ms);
		if(typeof timer.unref === 'function') {
			timer.unref();
		}
	});
}

function recoverFromTransientConnectionError(error) {
	const reason = 'connect retry after transient error: ' + (error && (error.code || error.message) || 'unknown');
	network.resetSocket(reason);
	network.requestRecoveryDiscovery(reason);
}

module.exports = function(options) {
	let handle = network.ref();
	let attemptsLeft = options && Number.isInteger(options.connectionRetries) ? options.connectionRetries : 5;
	let attempt = 0;

	const findDeviceWithRetry = () => {
		return network.findDeviceViaAddress(options)
			.catch(error => {
				if(! isTransientConnectionError(error) || attemptsLeft-- <= 0) {
					throw error;
				}

				recoverFromTransientConnectionError(error);

				const delay = getRetryDelay(attempt);
				attempt++;

				return wait(delay)
					.then(() => findDeviceWithRetry());
			});
	};

	// Connecting to a device via IP, ask the network if it knows about it
	return findDeviceWithRetry()
		.then(device => {
			const deviceHandle = {
				ref: network.ref(),
				api: device
			};

			// Try to resolve the correct model, otherwise use the generic device
			const d = models[device.model];
			if(! d) {
				return new Device(deviceHandle);
			} else {
				return new d(deviceHandle);
			}
		})
		.catch(e => {
			if((e.code === 'missing-token' || e.code === 'connection-failure') && options.withPlaceholder) {
				const deviceHandle = {
					ref: network.ref(),
					api: e.device
				};

				return new Placeholder(deviceHandle);
			}

			// Error handling - make sure to always release the handle
			handle.release();

			e.device = null;
			throw e;
		})
		.then(device => {
			// Make sure to release the handle
			handle.release();

			return device.init();
		});
};
