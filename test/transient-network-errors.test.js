'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('util');

const {
	normalizeNetworkError,
	isTransientNetworkError
} = require('../lib/transientNetworkErrors');

test('normalizeNetworkError uppercases lowercase transient codes', () => {
	const err = new Error('interrupted system call');
	err.code = 'eintr';

	normalizeNetworkError(err);

	assert.equal(err.code, 'EINTR');
	assert.equal(isTransientNetworkError(err), true);
});

test('normalizeNetworkError maps nested cause transient code', () => {
	const err = new Error('outer wrapper');
	err.cause = Object.assign(new Error('inner transient error'), {
		code: 'ealready'
	});

	normalizeNetworkError(err);

	assert.equal(err.code, 'EALREADY');
	assert.equal(isTransientNetworkError(err), true);
});

test('normalizeNetworkError maps errno numbers to symbolic transient code when available', () => {
	if (typeof util.getSystemErrorMap !== 'function') {
		return;
	}

	const systemErrors = util.getSystemErrorMap();
	let eintrErrno = null;
	for (const [errno, [code]] of systemErrors) {
		if (code === 'EINTR') {
			eintrErrno = errno;
			break;
		}
	}

	if (eintrErrno === null) {
		return;
	}

	const err = new Error('interrupted');
	err.errno = eintrErrno;

	normalizeNetworkError(err);

	assert.equal(err.code, 'EINTR');
	assert.equal(isTransientNetworkError(err), true);
});

test('isTransientNetworkError treats network communication message as transient regardless of casing', () => {
	const err = new Error('network communication is unavailable while polling');

	assert.equal(isTransientNetworkError(err), true);
});

test('isTransientNetworkError treats wrapped lowercase network communication message as transient', () => {
	const err = new Error('outer wrapper');
	err.cause = new Error('NETWORK COMMUNICATION IS UNAVAILABLE while reconnecting');

	assert.equal(isTransientNetworkError(err), true);
});
