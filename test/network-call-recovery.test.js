'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('util');

const network = require('../lib/network');
const { TRANSIENT_NETWORK_ERROR_CODES } = require('../lib/transientNetworkErrors');

function createTransientError(code) {
	const error = new Error(code + ' simulated failure');
	error.code = code;
	return error;
}

function createTestDeviceInfo() {
	const suffix = Date.now().toString(16) + Math.random().toString(16).slice(2);
	return network.findDevice('test-device-' + suffix, {
		address: '127.0.0.1',
		port: 54321
	});
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
	test(`device call triggers recovery flow for transient ${code} send errors`, async () => {
		const device = createTestDeviceInfo();
		const originalSocket = network._socket;
		const originalResetSocket = network.resetSocket;
		const originalRequestRecoveryDiscovery = network.requestRecoveryDiscovery;
		const originalHandshake = device.handshake;
		const originalSetTimeout = global.setTimeout;

		const recoveryReasons = [];
		network.resetSocket = reason => {
			recoveryReasons.push(['resetSocket', reason]);
		};
		network.requestRecoveryDiscovery = reason => {
			recoveryReasons.push(['requestRecoveryDiscovery', reason]);
		};

		device.handshake = () => Promise.resolve(Buffer.alloc(16, 1));
		device.packet.token = Buffer.alloc(16, 1);
		global.setTimeout = (handler, timeout, ...args) => {
			const timer = originalSetTimeout(handler, Math.min(timeout, 5), ...args);
			timer.unref = () => timer;
			return timer;
		};
		network._socket = {
			send(data, offset, length, port, address, callback) {
				callback(createTransientError(code));
			}
		};

		try {
			await assert.rejects(device.call('miIO.info', [], { retries: 0 }));

			assert.ok(recoveryReasons.length >= 2);
			assert.equal(recoveryReasons[0][0], 'resetSocket');
			assert.equal(recoveryReasons[1][0], 'requestRecoveryDiscovery');
			assert.match(recoveryReasons[0][1], new RegExp(`socket send error: ${code}`));
		} finally {
			global.setTimeout = originalSetTimeout;
			network._socket = originalSocket;
			network.resetSocket = originalResetSocket;
			network.requestRecoveryDiscovery = originalRequestRecoveryDiscovery;
			device.handshake = originalHandshake;
		}
	});
}

for (const code of TRANSIENT_NETWORK_ERROR_CODES) {
	if (code === 'timeout') continue;

	test(`device call triggers recovery flow for transient ${code} handshake errors`, async () => {
		const device = createTestDeviceInfo();
		const originalResetSocket = network.resetSocket;
		const originalRequestRecoveryDiscovery = network.requestRecoveryDiscovery;
		const originalHandshake = device.handshake;
		const originalSetTimeout = global.setTimeout;

		const recoveryReasons = [];
		network.resetSocket = reason => {
			recoveryReasons.push(['resetSocket', reason]);
		};
		network.requestRecoveryDiscovery = reason => {
			recoveryReasons.push(['requestRecoveryDiscovery', reason]);
		};

		device.packet.token = Buffer.alloc(16, 1);
		device.packet.markHandshakeRequired();
		device.handshake = () => Promise.reject(createTransientError(code));
		global.setTimeout = (handler, timeout, ...args) => {
			const timer = originalSetTimeout(handler, Math.min(timeout, 5), ...args);
			timer.unref = () => timer;
			return timer;
		};

		try {
			await assert.rejects(device.call('miIO.info', [], { retries: 0 }));

			assert.ok(recoveryReasons.length >= 2);
			assert.equal(recoveryReasons[0][0], 'resetSocket');
			assert.equal(recoveryReasons[1][0], 'requestRecoveryDiscovery');
			assert.match(recoveryReasons[0][1], new RegExp(`handshake network error: ${code}`));
		} finally {
			global.setTimeout = originalSetTimeout;
			network.resetSocket = originalResetSocket;
			network.requestRecoveryDiscovery = originalRequestRecoveryDiscovery;
			device.handshake = originalHandshake;
		}
	});
}

for (const code of TRANSIENT_NETWORK_ERROR_CODES) {
	test(`device call triggers recovery flow for transient ${code} socket send throw errors`, async () => {
		const device = createTestDeviceInfo();
		const originalSocket = network._socket;
		const originalResetSocket = network.resetSocket;
		const originalRequestRecoveryDiscovery = network.requestRecoveryDiscovery;
		const originalHandshake = device.handshake;
		const originalSetTimeout = global.setTimeout;

		const recoveryReasons = [];
		network.resetSocket = reason => {
			recoveryReasons.push(['resetSocket', reason]);
		};
		network.requestRecoveryDiscovery = reason => {
			recoveryReasons.push(['requestRecoveryDiscovery', reason]);
		};

		device.handshake = () => Promise.resolve(Buffer.alloc(16, 1));
		device.packet.token = Buffer.alloc(16, 1);
		global.setTimeout = (handler, timeout, ...args) => {
			const timer = originalSetTimeout(handler, Math.min(timeout, 5), ...args);
			timer.unref = () => timer;
			return timer;
		};
		network._socket = {
			send() {
				throw createTransientError(code);
			}
		};

		try {
			await assert.rejects(device.call('miIO.info', [], { retries: 0 }));

			assert.ok(recoveryReasons.length >= 2);
			assert.equal(recoveryReasons[0][0], 'resetSocket');
			assert.equal(recoveryReasons[1][0], 'requestRecoveryDiscovery');
			assert.match(recoveryReasons[0][1], new RegExp(`socket send throw: ${code}`));
		} finally {
			global.setTimeout = originalSetTimeout;
			network._socket = originalSocket;
			network.resetSocket = originalResetSocket;
			network.requestRecoveryDiscovery = originalRequestRecoveryDiscovery;
			device.handshake = originalHandshake;
		}
	});
}

test('transient network error code list includes reconnect race conditions', () => {
	assert.ok(TRANSIENT_NETWORK_ERROR_CODES.has('EINTR'));
	assert.ok(TRANSIENT_NETWORK_ERROR_CODES.has('EALREADY'));
	assert.ok(TRANSIENT_NETWORK_ERROR_CODES.has('EINPROGRESS'));
	assert.ok(TRANSIENT_NETWORK_ERROR_CODES.has('ECONNABORTED'));
});

test('device call triggers recovery flow when handshake times out', async () => {
	const device = createTestDeviceInfo();
	const originalResetSocket = network.resetSocket;
	const originalRequestRecoveryDiscovery = network.requestRecoveryDiscovery;
	const originalHandshake = device.handshake;
	const originalSetTimeout = global.setTimeout;

	const recoveryReasons = [];
	network.resetSocket = reason => {
		recoveryReasons.push(['resetSocket', reason]);
	};
	network.requestRecoveryDiscovery = reason => {
		recoveryReasons.push(['requestRecoveryDiscovery', reason]);
	};

	device.packet.token = Buffer.alloc(16, 1);
	device.packet.markHandshakeRequired();
	device.handshake = () => Promise.reject(createTransientError('timeout'));
	global.setTimeout = (handler, timeout, ...args) => {
		const timer = originalSetTimeout(handler, Math.min(timeout, 5), ...args);
		timer.unref = () => timer;
		return timer;
	};

	try {
		await assert.rejects(device.call('miIO.info', [], { retries: 0 }));

		assert.ok(recoveryReasons.length >= 2);
		assert.equal(recoveryReasons[0][0], 'resetSocket');
		assert.equal(recoveryReasons[1][0], 'requestRecoveryDiscovery');
		assert.match(recoveryReasons[0][1], /retry due to handshake timeout/);
	} finally {
		global.setTimeout = originalSetTimeout;
		network.resetSocket = originalResetSocket;
		network.requestRecoveryDiscovery = originalRequestRecoveryDiscovery;
		device.handshake = originalHandshake;
	}
});

for (const code of ['EINTR', 'EALREADY']) {
	test(`device call normalizes ${code} errno callback failures and triggers recovery`, async () => {
		const errno = getErrnoForCode(code);
		if (errno === null) {
			return;
		}

		const device = createTestDeviceInfo();
		const originalSocket = network._socket;
		const originalResetSocket = network.resetSocket;
		const originalRequestRecoveryDiscovery = network.requestRecoveryDiscovery;
		const originalHandshake = device.handshake;
		const originalSetTimeout = global.setTimeout;

		const recoveryReasons = [];
		network.resetSocket = reason => {
			recoveryReasons.push(['resetSocket', reason]);
		};
		network.requestRecoveryDiscovery = reason => {
			recoveryReasons.push(['requestRecoveryDiscovery', reason]);
		};

		device.handshake = () => Promise.resolve(Buffer.alloc(16, 1));
		device.packet.token = Buffer.alloc(16, 1);
		global.setTimeout = (handler, timeout, ...args) => {
			const timer = originalSetTimeout(handler, Math.min(timeout, 5), ...args);
			timer.unref = () => timer;
			return timer;
		};
		network._socket = {
			send(data, offset, length, port, address, callback) {
				const err = new Error(code + ' simulated errno failure');
				err.errno = errno;
				callback(err);
			}
		};

		try {
			await assert.rejects(device.call('miIO.info', [], { retries: 0 }));

			assert.ok(recoveryReasons.length >= 2);
			assert.equal(recoveryReasons[0][0], 'resetSocket');
			assert.equal(recoveryReasons[1][0], 'requestRecoveryDiscovery');
			assert.match(recoveryReasons[0][1], new RegExp(`socket send error: ${code}`));
		} finally {
			global.setTimeout = originalSetTimeout;
			network._socket = originalSocket;
			network.resetSocket = originalResetSocket;
			network.requestRecoveryDiscovery = originalRequestRecoveryDiscovery;
			device.handshake = originalHandshake;
		}
	});
}
