'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const network = require('../lib/network');
const { TRANSIENT_NETWORK_ERROR_CODES } = require('../lib/transientNetworkErrors');

function createTransientError(code) {
	const err = new Error(code);
	err.code = code;
	return err;
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
