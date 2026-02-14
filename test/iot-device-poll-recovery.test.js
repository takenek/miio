'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const IotDevice = require('../lib/iotDevice');

class TestDevice extends IotDevice {}

function createDevice(network) {
	return new TestDevice({
		api: {
			id: 'test-device',
			model: 'test.model',
			parent: network
		},
		ref: {
			release() {}
		}
	});
}

test('iotDevice poll triggers network recovery for recoverable errors', async () => {
	const calls = [];
	const network = {
		resetSocket: reason => calls.push(['resetSocket', reason]),
		requestRecoveryDiscovery: reason => calls.push(['requestRecoveryDiscovery', reason])
	};

	const device = createDevice(network);
	const err = new Error('simulated socket outage');
	err.code = 'ENETDOWN';
	device._loadProperties = () => Promise.reject(err);

	const result = await device.poll(false);
	assert.equal(result, null);
	assert.deepEqual(calls.map(entry => entry[0]), ['resetSocket', 'requestRecoveryDiscovery']);
	assert.match(calls[0][1], /poll recoverable error: ENETDOWN/);
	assert.match(calls[1][1], /poll recoverable error: ENETDOWN/);
});

test('iotDevice poll does not recover for non-recoverable errors', async () => {
	const calls = [];
	const network = {
		resetSocket: reason => calls.push(['resetSocket', reason]),
		requestRecoveryDiscovery: reason => calls.push(['requestRecoveryDiscovery', reason])
	};

	const device = createDevice(network);
	const err = new Error('bad response');
	err.code = 'invalid-response';
	device._loadProperties = () => Promise.reject(err);

	await assert.rejects(device.poll(false), error => {
		assert.equal(error, err);
		return true;
	});
	assert.equal(calls.length, 0);
});
