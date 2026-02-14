'use strict';

const EventEmitter = require('events');

const search = Symbol('search');
const addService = Symbol('addService');
const removeService = Symbol('removeService');

const SEARCH_INTERVAL = 30000;
const STALE_CHECK_INTERVAL = 60000;

/**
 * Base discovery with simple add/remove service tracking.
 */
class BasicDiscovery extends EventEmitter {
	constructor() {
		super();

		this._services = new Map();
	}

	start() {
	}

	stop() {
	}

	[addService](service) {
		const id = service && service.id !== undefined ? service.id : service;
		if(! this._services.has(id)) {
			this._services.set(id, service);
			this.emit('available', service);
		} else {
			this._services.set(id, service);
			this.emit('update', service);
		}
	}

	[removeService](service) {
		const id = service && service.id !== undefined ? service.id : service;
		const existing = this._services.get(id);
		if(existing) {
			this._services.delete(id);
			this.emit('unavailable', existing);
		}
	}
}

/**
 * Discovery with periodic search and stale service eviction.
 */
class TimedDiscovery extends BasicDiscovery {
	constructor(options) {
		super();

		this._maxStaleTime = (options && options.maxStaleTime) || 60000;
		this._timestamps = new Map();
		this._searchInterval = null;
		this._staleInterval = null;
		this._started = false;
	}

	start() {
		if(this._started) return;
		this._started = true;

		this[search]();

		this._searchInterval = setInterval(() => {
			this[search]();
		}, SEARCH_INTERVAL);

		this._staleInterval = setInterval(() => {
			this._removeStale();
		}, STALE_CHECK_INTERVAL);

		// Do not prevent Node from exiting
		if(this._searchInterval.unref) this._searchInterval.unref();
		if(this._staleInterval.unref) this._staleInterval.unref();
	}

	stop() {
		if(! this._started) return;
		this._started = false;

		if(this._searchInterval) {
			clearInterval(this._searchInterval);
			this._searchInterval = null;
		}
		if(this._staleInterval) {
			clearInterval(this._staleInterval);
			this._staleInterval = null;
		}
	}

	[search]() {
		// Abstract — override in subclass
	}

	[addService](service) {
		const id = service.id;
		this._timestamps.set(id, Date.now());

		if(! this._services.has(id)) {
			this._services.set(id, service);
			this.emit('available', service);
		} else {
			this._services.set(id, service);
			this.emit('update', service);
		}
	}

	_removeStale() {
		const now = Date.now();
		for(const [id, timestamp] of this._timestamps) {
			if(now - timestamp > this._maxStaleTime) {
				const service = this._services.get(id);
				if(service) {
					this._services.delete(id);
					this._timestamps.delete(id);
					this.emit('unavailable', service);
				}
			}
		}
	}

	map(mapper) {
		return new MappedDiscovery(this, mapper);
	}
}

/**
 * Wraps a parent discovery and transforms each service through a mapper
 * function (which may return a Promise).
 */
class MappedDiscovery extends EventEmitter {
	constructor(parent, mapper) {
		super();

		this._parent = parent;
		this._mapped = new Map();
		this._mapVersions = new Map();

		const tryMapService = service => {
			const id = service.id;
			const version = (this._mapVersions.get(id) || 0) + 1;
			this._mapVersions.set(id, version);

			Promise.resolve(mapper(service))
				.then(result => {
					if(this._mapVersions.get(id) !== version) return;

					const isNew = ! this._mapped.has(id);
					this._mapped.set(id, result);

					if(isNew) {
						this.emit('available', result);
					} else {
						this.emit('update', result);
					}
				})
				.catch(() => {
					// Mapping failed — keep trying on next update/available event
				});
		};

		parent.on('available', tryMapService);
		parent.on('update', tryMapService);

		parent.on('unavailable', service => {
			const id = service.id;
			this._mapVersions.delete(id);
			const mapped = this._mapped.get(id);
			if(mapped) {
				this._mapped.delete(id);
				this.emit('unavailable', mapped);
			}
		});
	}

	start() {
		this._parent.start();
	}

	stop() {
		this._parent.stop();
	}
}

module.exports = {
	TimedDiscovery,
	BasicDiscovery,
	MappedDiscovery,
	search,
	addService,
	removeService
};
