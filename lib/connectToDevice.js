'use strict';

const network = require('./network');

const Device = require('./device');
const Placeholder = require('./placeholder');
const models = require('./models');

const { isTransientNetworkError } = require('./transientNetworkErrors');

const RETRY_BASE_DELAY = 1000;
const RETRY_MAX_DELAY = 8000;

function isTransientConnectionError(error) {
	if (error && error.code === 'connection-failure') {
		return true;
	}

	return isTransientNetworkError(error);
}

function getRetryDelay(attempt) {
	const exponential = RETRY_BASE_DELAY * Math.pow(2, attempt);
	const baseDelay = Math.min(exponential, RETRY_MAX_DELAY);
	const jitter = Math.floor(Math.random() * RETRY_BASE_DELAY);
	return baseDelay + jitter;
}

function wait(ms) {
	return new Promise(resolve => {
		const timer = setTimeout(resolve, ms);
		if(typeof timer.unref === 'function') {
			timer.unref();
		}
	});
}

function recoverFromTransientConnectionError(error) {
	const reason = 'connect retry after transient error: ' + (error && (error.code || error.message) || 'unknown');
	network.resetSocket(reason);
	network.requestRecoveryDiscovery(reason);
}

module.exports = function(options) {
	let handle = network.ref();
	let attemptsLeft = options && Number.isInteger(options.connectionRetries) ? options.connectionRetries : 5;
	let attempt = 0;

	const findDeviceWithRetry = () => {
		return network.findDeviceViaAddress(options)
			.catch(error => {
				if(! isTransientConnectionError(error) || attemptsLeft-- <= 0) {
					throw error;
				}

				recoverFromTransientConnectionError(error);

				const delay = getRetryDelay(attempt);
				attempt++;

				return wait(delay)
					.then(() => findDeviceWithRetry());
			});
	};

	// Connecting to a device via IP, ask the network if it knows about it
	return findDeviceWithRetry()
		.then(device => {
			const deviceHandle = {
				ref: network.ref(),
				api: device
			};

			// Try to resolve the correct model, otherwise use the generic device
			const d = models[device.model];
			if(! d) {
				return new Device(deviceHandle);
			} else {
				return new d(deviceHandle);
			}
		})
		.catch(e => {
			if((e.code === 'missing-token' || e.code === 'connection-failure') && options.withPlaceholder) {
				const deviceHandle = {
					ref: network.ref(),
					api: e.device
				};

				return new Placeholder(deviceHandle);
			}

			// Error handling - make sure to always release the handle
			handle.release();

			e.device = null;
			throw e;
		})
		.then(device => {
			// Make sure to release the handle
			handle.release();

			return device.init();
		});
};
