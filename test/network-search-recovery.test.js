'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('util');

const network = require('../lib/network');
const { TRANSIENT_NETWORK_ERROR_CODES } = require('../lib/transientNetworkErrors');

function createTransientError(code) {
	const err = new Error(code);
	err.code = code;
	return err;
}

function getErrnoForCode(code) {
	if (typeof util.getSystemErrorMap !== 'function') {
		return null;
	}

	for (const [errno, [mappedCode]] of util.getSystemErrorMap()) {
		if (mappedCode === code) {
			return errno;
		}
	}

	return null;
}

for (const code of TRANSIENT_NETWORK_ERROR_CODES) {
	test(`search resets socket when discovery cannot access socket (${code})`, () => {
		let resetReason;
		const originalResetSocket = network.resetSocket;
		const originalDescriptor = Object.getOwnPropertyDescriptor(network, 'socket');

		network.resetSocket = reason => {
			resetReason = reason;
		};

		Object.defineProperty(network, 'socket', {
			configurable: true,
			get() {
				throw createTransientError(code);
			}
		});

		assert.doesNotThrow(() => network.search());
		assert.match(resetReason, new RegExp(`discovery socket unavailable: ${code}`));

		if (originalDescriptor) {
			Object.defineProperty(network, 'socket', originalDescriptor);
		} else {
			delete network.socket;
		}
		network.resetSocket = originalResetSocket;
	});

	test(`search resets socket when discovery broadcast callback fails transiently (${code})`, async () => {
		let resetReason;
		const originalResetSocket = network.resetSocket;
		const originalDescriptor = Object.getOwnPropertyDescriptor(network, 'socket');

		network.resetSocket = reason => {
			resetReason = reason;
		};

		Object.defineProperty(network, 'socket', {
			configurable: true,
			get() {
				return {
					send(data, offset, length, port, address, callback) {
						callback(createTransientError(code));
					}
				};
			}
		});

		network.search();
		await new Promise(resolve => setTimeout(resolve, 10));
		assert.match(resetReason, new RegExp(`discovery broadcast error: ${code}`));

		if (originalDescriptor) {
			Object.defineProperty(network, 'socket', originalDescriptor);
		} else {
			delete network.socket;
		}
		network.resetSocket = originalResetSocket;
	});
}

test('search normalizes lowercase transient discovery access errors', () => {
	let resetReason;
	const originalResetSocket = network.resetSocket;
	const originalDescriptor = Object.getOwnPropertyDescriptor(network, 'socket');

	network.resetSocket = reason => {
		resetReason = reason;
	};

	Object.defineProperty(network, 'socket', {
		configurable: true,
		get() {
			throw createTransientError('eintr');
		}
	});

	assert.doesNotThrow(() => network.search());
	assert.match(resetReason, /discovery socket unavailable: EINTR/);

	if (originalDescriptor) {
		Object.defineProperty(network, 'socket', originalDescriptor);
	} else {
		delete network.socket;
	}
	network.resetSocket = originalResetSocket;
});

test('search normalizes nested-cause transient discovery callback errors', async () => {
	let resetReason;
	const originalResetSocket = network.resetSocket;
	const originalDescriptor = Object.getOwnPropertyDescriptor(network, 'socket');

	network.resetSocket = reason => {
		resetReason = reason;
	};

	Object.defineProperty(network, 'socket', {
		configurable: true,
		get() {
			return {
				send(data, offset, length, port, address, callback) {
					const err = new Error('wrapper callback error');
					err.cause = createTransientError('EALREADY');
					callback(err);
				}
			};
		}
	});

	network.search();
	await new Promise(resolve => setTimeout(resolve, 10));
	assert.match(resetReason, /discovery broadcast error: EALREADY/);

	if (originalDescriptor) {
		Object.defineProperty(network, 'socket', originalDescriptor);
	} else {
		delete network.socket;
	}
	network.resetSocket = originalResetSocket;
});

test('search resets socket when discovery broadcast callback fails with transient outage message only', async () => {
	let resetReason;
	const originalResetSocket = network.resetSocket;
	const originalDescriptor = Object.getOwnPropertyDescriptor(network, 'socket');

	network.resetSocket = reason => {
		resetReason = reason;
	};

	Object.defineProperty(network, 'socket', {
		configurable: true,
		get() {
			return {
				send(data, offset, length, port, address, callback) {
					callback(new Error('NETWORK COMMUNICATION IS UNAVAILABLE while sending discovery'));
				}
			};
		}
	});

	network.search();
	await new Promise(resolve => setTimeout(resolve, 10));
	assert.match(resetReason, /discovery broadcast error:/);

	if (originalDescriptor) {
		Object.defineProperty(network, 'socket', originalDescriptor);
	} else {
		delete network.socket;
	}
	network.resetSocket = originalResetSocket;
});

for (const code of ['EINTR', 'EALREADY', 'ENOTCONN', 'EHOSTUNREACH', 'ETIMEDOUT']) {
	test(`search normalizes ${code} errno transient discovery callback errors`, async () => {
		const errno = getErrnoForCode(code);
		if (errno === null) {
			return;
		}

		let resetReason;
		const originalResetSocket = network.resetSocket;
		const originalDescriptor = Object.getOwnPropertyDescriptor(network, 'socket');

		network.resetSocket = reason => {
			resetReason = reason;
		};

		Object.defineProperty(network, 'socket', {
			configurable: true,
			get() {
				return {
					send(data, offset, length, port, address, callback) {
						const err = new Error('discovery errno failure');
						err.errno = errno;
						callback(err);
					}
				};
			}
		});

		network.search();
		await new Promise(resolve => setTimeout(resolve, 10));
		assert.match(resetReason, new RegExp(`discovery broadcast error: ${code}`));

		if (originalDescriptor) {
			Object.defineProperty(network, 'socket', originalDescriptor);
		} else {
			delete network.socket;
		}
		network.resetSocket = originalResetSocket;
	});
}

test('requestRecoveryDiscovery swallows unexpected synchronous discovery failures', () => {
	const originalSearch = network.search;
	const originalReferences = network.references;
	const originalLastRecoveryDiscovery = network._lastRecoveryDiscovery;

	network.references = 1;
	network._lastRecoveryDiscovery = 0;
	network.search = () => {
		throw new Error('unexpected discovery failure');
	};

	assert.doesNotThrow(() => {
		network.requestRecoveryDiscovery('test');
	});

	network.search = originalSearch;
	network.references = originalReferences;
	network._lastRecoveryDiscovery = originalLastRecoveryDiscovery;
});

test('requestRecoveryDiscovery defers discovery while socket reset is in progress', async () => {
	const originalSearch = network.search;
	const originalReferences = network.references;
	const originalLastRecoveryDiscovery = network._lastRecoveryDiscovery;
	const originalSocketResetInProgress = network._socketResetInProgress;
	const originalSocket = network._socket;
	const originalPendingRecoveryDiscovery = network._pendingRecoveryDiscovery;

	let searchCalls = 0;
	network.search = () => {
		searchCalls++;
	};

	network.references = 1;
	network._lastRecoveryDiscovery = 0;
	network._socketResetInProgress = true;
	network._socket = null;
	network._pendingRecoveryDiscovery = null;

	network.requestRecoveryDiscovery('test');
	assert.equal(searchCalls, 0);

	network._socketResetInProgress = false;
	network._socket = {
		send(data, offset, length, port, address, callback) {
			if (typeof callback === 'function') callback(null);
		}
	};

	await new Promise(resolve => setTimeout(resolve, 350));
	assert.ok(searchCalls >= 1);

	if (network._pendingRecoveryDiscovery) {
		clearTimeout(network._pendingRecoveryDiscovery);
	}
	network.search = originalSearch;
	network.references = originalReferences;
	network._lastRecoveryDiscovery = originalLastRecoveryDiscovery;
	network._socketResetInProgress = originalSocketResetInProgress;
	network._socket = originalSocket;
	network._pendingRecoveryDiscovery = originalPendingRecoveryDiscovery;
});

test('requestRecoveryDiscovery clears deferred discovery when references are released', async () => {
	const originalSearch = network.search;
	const originalReferences = network.references;
	const originalLastRecoveryDiscovery = network._lastRecoveryDiscovery;
	const originalSocketResetInProgress = network._socketResetInProgress;
	const originalSocket = network._socket;
	const originalPendingRecoveryDiscovery = network._pendingRecoveryDiscovery;

	let searchCalls = 0;
	network.search = () => {
		searchCalls++;
	};

	network.references = 1;
	network._lastRecoveryDiscovery = 0;
	network._socketResetInProgress = true;
	network._socket = null;
	network._pendingRecoveryDiscovery = null;

	network.requestRecoveryDiscovery('test');
	assert.ok(network._pendingRecoveryDiscovery);

	network.references = 0;
	network.updateSocket();

	await new Promise(resolve => setTimeout(resolve, 350));
	assert.equal(searchCalls, 0);

	network.search = originalSearch;
	network.references = originalReferences;
	network._lastRecoveryDiscovery = originalLastRecoveryDiscovery;
	network._socketResetInProgress = originalSocketResetInProgress;
	network._socket = originalSocket;
	network._pendingRecoveryDiscovery = originalPendingRecoveryDiscovery;
});
