'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const network = require('../lib/network');

function createTransientError(code) {
	const err = new Error(code);
	err.code = code;
	return err;
}

test('search resets socket when discovery cannot access socket', () => {
	let resetReason;
	const originalResetSocket = network.resetSocket;
	const originalDescriptor = Object.getOwnPropertyDescriptor(network, 'socket');

	network.resetSocket = reason => {
		resetReason = reason;
	};

	Object.defineProperty(network, 'socket', {
		configurable: true,
		get() {
			throw createTransientError('ENOTCONN');
		}
	});

	assert.doesNotThrow(() => network.search());
	assert.match(resetReason, /discovery socket unavailable: ENOTCONN/);

	if (originalDescriptor) {
		Object.defineProperty(network, 'socket', originalDescriptor);
	} else {
		delete network.socket;
	}
	network.resetSocket = originalResetSocket;
});

test('search resets socket when discovery broadcast callback fails transiently', async () => {
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
					callback(createTransientError('ENETDOWN'));
				}
			};
		}
	});

	network.search();
	await new Promise(resolve => setTimeout(resolve, 10));
	assert.match(resetReason, /discovery broadcast error: ENETDOWN/);

	if (originalDescriptor) {
		Object.defineProperty(network, 'socket', originalDescriptor);
	} else {
		delete network.socket;
	}
	network.resetSocket = originalResetSocket;
});

test('search resets socket when discovery broadcast callback fails with EINTR', async () => {
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
					callback(createTransientError('EINTR'));
				}
			};
		}
	});

	network.search();
	await new Promise(resolve => setTimeout(resolve, 10));
	assert.match(resetReason, /discovery broadcast error: EINTR/);

	if (originalDescriptor) {
		Object.defineProperty(network, 'socket', originalDescriptor);
	} else {
		delete network.socket;
	}
	network.resetSocket = originalResetSocket;
});
