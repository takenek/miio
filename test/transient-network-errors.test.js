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

function assertNormalizeErrnoCode(code) {
	if (typeof util.getSystemErrorMap !== 'function') {
		return;
	}

	const systemErrors = util.getSystemErrorMap();
	let mappedErrno = null;
	for (const [errno, [mapCode]] of systemErrors) {
		if (mapCode === code) {
			mappedErrno = errno;
			break;
		}
	}

	if (mappedErrno === null) {
		return;
	}

	const err = new Error('interrupted');
	err.errno = mappedErrno;

	normalizeNetworkError(err);

	assert.equal(err.code, code);
	assert.equal(isTransientNetworkError(err), true);
}

test('normalizeNetworkError maps EINTR errno numbers to symbolic transient code when available', () => {
	assertNormalizeErrnoCode('EINTR');
});

test('normalizeNetworkError maps EALREADY errno numbers to symbolic transient code when available', () => {
	assertNormalizeErrnoCode('EALREADY');
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
