'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const DeviceManagement = require('../lib/management');
const tokens = require('../lib/tokens');

const connectToDevicePath = require.resolve('../lib/connectToDevice');
require(connectToDevicePath);

test('updateToken verifies token using the current device port', async () => {
	const originalTokensUpdate = tokens.update;
	const originalConnectExport = require.cache[connectToDevicePath].exports;

	const calls = [];
	let destroyed = false;

	tokens.update = () => Promise.resolve();
	require.cache[connectToDevicePath].exports = options => {
		calls.push(options);
		return Promise.resolve({
			destroy() {
				destroyed = true;
				return Promise.resolve();
			}
		});
	};

	try {
		const api = {
			id: '12345',
			address: '192.168.1.50',
			port: 43210,
			token: Buffer.from('00112233445566778899aabbccddeeff', 'hex')
		};

		const management = new DeviceManagement({
			handle: {
				api
			}
		});

		const result = await management.updateToken('ffeeddccbbaa99887766554433221100');

		assert.equal(result, true);
		assert.equal(destroyed, true);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].address, api.address);
		assert.equal(calls[0].port, api.port);
	} finally {
		tokens.update = originalTokensUpdate;
		require.cache[connectToDevicePath].exports = originalConnectExport;
	}
});
