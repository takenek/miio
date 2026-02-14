'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('util');

const network = require('../lib/network');
const connectToDevice = require('../lib/connectToDevice');
const { TRANSIENT_NETWORK_ERROR_CODES } = require('../lib/transientNetworkErrors');

const TRANSIENT_CONNECT_ERROR_CODES = [
	...TRANSIENT_NETWORK_ERROR_CODES,
	'connection-failure'
];

for (const transientCode of TRANSIENT_CONNECT_ERROR_CODES) {
	test(`connectToDevice retries transient ${transientCode} failures and triggers recovery`, async () => {
		const originalRef = network.ref;
		const originalFindDeviceViaAddress = network.findDeviceViaAddress;
		const originalResetSocket = network.resetSocket;
		const originalRequestRecoveryDiscovery = network.requestRecoveryDiscovery;
		const originalSetTimeout = global.setTimeout;

		let refCount = 0;
		let releaseCount = 0;
		let findAttempts = 0;
		const recoveryReasons = [];

		global.setTimeout = (handler, timeout, ...args) => {
			const timer = originalSetTimeout(handler, timeout, ...args);
			timer.unref = () => timer;
			return timer;
		};

		try {
			network.ref = () => {
				refCount++;
				return {
					release() {
						releaseCount++;
					}
				};
			};

			network.resetSocket = reason => {
				recoveryReasons.push(['resetSocket', reason]);
			};

			network.requestRecoveryDiscovery = reason => {
				recoveryReasons.push(['requestRecoveryDiscovery', reason]);
			};

			network.findDeviceViaAddress = async () => {
				findAttempts++;
				if (findAttempts === 1) {
					const err = new Error('simulated transient connect error');
					err.code = transientCode;
					throw err;
				}

				throw new Error('non transient failure');
			};

			await assert.rejects(
				connectToDevice({
					address: '127.0.0.1',
					port: 54321,
					connectionRetries: 1
				}),
				error => {
					assert.match(error.message, /non transient failure/);
					return true;
				}
			);

			assert.equal(findAttempts, 2);
			assert.deepEqual(
				recoveryReasons.map(entry => entry[0]),
				['resetSocket', 'requestRecoveryDiscovery']
			);
			assert.match(recoveryReasons[0][1], new RegExp(`connect retry after transient error: ${transientCode}`));
			assert.ok(refCount >= 1);
			assert.ok(releaseCount >= 1);
		} finally {
			network.ref = originalRef;
			network.findDeviceViaAddress = originalFindDeviceViaAddress;
			network.resetSocket = originalResetSocket;
			network.requestRecoveryDiscovery = originalRequestRecoveryDiscovery;
			global.setTimeout = originalSetTimeout;
		}
	});
}

test('connectToDevice retries transient lowercase EINTR code and triggers recovery', async () => {
	const originalRef = network.ref;
	const originalFindDeviceViaAddress = network.findDeviceViaAddress;
	const originalResetSocket = network.resetSocket;
	const originalRequestRecoveryDiscovery = network.requestRecoveryDiscovery;
	const originalSetTimeout = global.setTimeout;

	let findAttempts = 0;
	const recoveryReasons = [];

	try {
		global.setTimeout = (handler, timeout, ...args) => {
			const timer = originalSetTimeout(handler, timeout, ...args);
			timer.unref = () => timer;
			return timer;
		};

		network.ref = () => ({ release() {} });
		network.resetSocket = reason => {
			recoveryReasons.push(['resetSocket', reason]);
		};
		network.requestRecoveryDiscovery = reason => {
			recoveryReasons.push(['requestRecoveryDiscovery', reason]);
		};

		network.findDeviceViaAddress = async () => {
			findAttempts++;
			if (findAttempts === 1) {
				const err = new Error('simulated lowercase transient connect error');
				err.code = 'eintr';
				throw err;
			}

			throw new Error('non transient failure');
		};

		await assert.rejects(connectToDevice({
			address: '127.0.0.1',
			port: 54321,
			connectionRetries: 1
		}));

		assert.equal(findAttempts, 2);
		assert.deepEqual(recoveryReasons.map(entry => entry[0]), ['resetSocket', 'requestRecoveryDiscovery']);
		assert.match(recoveryReasons[0][1], /connect retry after transient error: EINTR/);
	} finally {
		global.setTimeout = originalSetTimeout;
		network.ref = originalRef;
		network.findDeviceViaAddress = originalFindDeviceViaAddress;
		network.resetSocket = originalResetSocket;
		network.requestRecoveryDiscovery = originalRequestRecoveryDiscovery;
	}
});

test('connectToDevice retries transient nested-cause EALREADY failures and triggers recovery', async () => {
	const originalRef = network.ref;
	const originalFindDeviceViaAddress = network.findDeviceViaAddress;
	const originalResetSocket = network.resetSocket;
	const originalRequestRecoveryDiscovery = network.requestRecoveryDiscovery;
	const originalSetTimeout = global.setTimeout;

	let findAttempts = 0;
	const recoveryReasons = [];

	try {
		global.setTimeout = (handler, timeout, ...args) => {
			const timer = originalSetTimeout(handler, timeout, ...args);
			timer.unref = () => timer;
			return timer;
		};

		network.ref = () => ({ release() {} });
		network.resetSocket = reason => {
			recoveryReasons.push(['resetSocket', reason]);
		};
		network.requestRecoveryDiscovery = reason => {
			recoveryReasons.push(['requestRecoveryDiscovery', reason]);
		};

		network.findDeviceViaAddress = async () => {
			findAttempts++;
			if (findAttempts === 1) {
				const err = new Error('wrapper error');
				err.cause = Object.assign(new Error('nested transient connect error'), {
					code: 'EALREADY'
				});
				throw err;
			}

			throw new Error('non transient failure');
		};

		await assert.rejects(connectToDevice({
			address: '127.0.0.1',
			port: 54321,
			connectionRetries: 1
		}));

		assert.equal(findAttempts, 2);
		assert.deepEqual(recoveryReasons.map(entry => entry[0]), ['resetSocket', 'requestRecoveryDiscovery']);
		assert.match(recoveryReasons[0][1], /connect retry after transient error: EALREADY/);
	} finally {
		global.setTimeout = originalSetTimeout;
		network.ref = originalRef;
		network.findDeviceViaAddress = originalFindDeviceViaAddress;
		network.resetSocket = originalResetSocket;
		network.requestRecoveryDiscovery = originalRequestRecoveryDiscovery;
	}
});

async function assertConnectRetryForErrnoCode(code) {
	if (typeof util.getSystemErrorMap !== 'function') {
		return;
	}

	let mappedErrno = null;
	for (const [errno, [mapCode]] of util.getSystemErrorMap()) {
		if (mapCode === code) {
			mappedErrno = errno;
			break;
		}
	}

	if (mappedErrno === null) {
		return;
	}

	const originalRef = network.ref;
	const originalFindDeviceViaAddress = network.findDeviceViaAddress;
	const originalResetSocket = network.resetSocket;
	const originalRequestRecoveryDiscovery = network.requestRecoveryDiscovery;
	const originalSetTimeout = global.setTimeout;

	let findAttempts = 0;
	const recoveryReasons = [];

	try {
		global.setTimeout = (handler, timeout, ...args) => {
			const timer = originalSetTimeout(handler, timeout, ...args);
			timer.unref = () => timer;
			return timer;
		};

		network.ref = () => ({ release() {} });
		network.resetSocket = reason => {
			recoveryReasons.push(['resetSocket', reason]);
		};
		network.requestRecoveryDiscovery = reason => {
			recoveryReasons.push(['requestRecoveryDiscovery', reason]);
		};

		network.findDeviceViaAddress = async () => {
			findAttempts++;
			if (findAttempts === 1) {
				const err = new Error('simulated transient connect errno error');
				err.errno = mappedErrno;
				throw err;
			}

			throw new Error('non transient failure');
		};

		await assert.rejects(connectToDevice({
			address: '127.0.0.1',
			port: 54321,
			connectionRetries: 1
		}));

		assert.equal(findAttempts, 2);
		assert.deepEqual(recoveryReasons.map(entry => entry[0]), ['resetSocket', 'requestRecoveryDiscovery']);
		assert.match(recoveryReasons[0][1], new RegExp(`connect retry after transient error: ${code}`));
	} finally {
		global.setTimeout = originalSetTimeout;
		network.ref = originalRef;
		network.findDeviceViaAddress = originalFindDeviceViaAddress;
		network.resetSocket = originalResetSocket;
		network.requestRecoveryDiscovery = originalRequestRecoveryDiscovery;
	}
}

for (const code of ['EINTR', 'EALREADY', 'ENOTCONN', 'EHOSTUNREACH', 'ETIMEDOUT']) {
	test(`connectToDevice retries transient ${code} errno failures and triggers recovery`, async () => {
		await assertConnectRetryForErrnoCode(code);
	});
}
