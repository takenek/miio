'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Device = require('../lib/device');

class TestDevice extends Device {}

function createDevice(network) {
	return new TestDevice({
		api: {
			id: 'legacy-test-device',
			model: 'test.model',
			parent: network
		},
		ref: {
			release() {}
		}
	});
}

test('legacy device poll treats lowercase EINTR as recoverable and normalizes reason', async () => {
	const calls = [];
	const network = {
		resetSocket: reason => calls.push(['resetSocket', reason]),
		requestRecoveryDiscovery: reason => calls.push(['requestRecoveryDiscovery', reason])
	};

	const device = createDevice(network);
	const err = new Error('transient lowercase communication failure');
	err.code = 'eintr';
	device._loadProperties = () => Promise.reject(err);

	const result = await device.poll(false);
	assert.equal(result, null);
	assert.deepEqual(calls.map(entry => entry[0]), ['resetSocket', 'requestRecoveryDiscovery']);
	assert.match(calls[0][1], /poll recoverable error: EINTR/);
});

test('legacy device poll treats nested-cause EALREADY as recoverable and normalizes reason', async () => {
	const calls = [];
	const network = {
		resetSocket: reason => calls.push(['resetSocket', reason]),
		requestRecoveryDiscovery: reason => calls.push(['requestRecoveryDiscovery', reason])
	};

	const device = createDevice(network);
	const err = new Error('transient wrapper failure');
	err.cause = Object.assign(new Error('nested communication failure'), {
		code: 'EALREADY'
	});
	device._loadProperties = () => Promise.reject(err);

	const result = await device.poll(false);
	assert.equal(result, null);
	assert.deepEqual(calls.map(entry => entry[0]), ['resetSocket', 'requestRecoveryDiscovery']);
	assert.match(calls[0][1], /poll recoverable error: EALREADY/);
});
