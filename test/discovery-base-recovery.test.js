'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TimedDiscovery, addService, removeService } = require('../lib/discovery-base');

class TestTimedDiscovery extends TimedDiscovery {
	constructor() {
		super({ maxStaleTime: 10 });
	}
}

test('removeService clears stale timestamp tracking', () => {
	const discovery = new TestTimedDiscovery();
	const service = { id: 'vacuum-1' };

	discovery[addService](service);
	assert.equal(discovery._timestamps.has(service.id), true);

	discovery[removeService](service.id);
	assert.equal(discovery._timestamps.has(service.id), false);
});

test('removed services are not kept in timestamp map during stale cleanup', () => {
	const discovery = new TestTimedDiscovery();
	const service = { id: 'vacuum-2' };

	discovery[addService](service);
	discovery[removeService](service);

	discovery._removeStale();

	assert.equal(discovery._timestamps.size, 0);
	assert.equal(discovery._services.size, 0);
});
