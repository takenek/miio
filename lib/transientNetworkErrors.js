'use strict';

const util = require('util');

const TRANSIENT_NETWORK_ERROR_CODES = new Set([
	'timeout',
	'ENOTCONN',
	'EHOSTUNREACH',
	'EHOSTDOWN',
	'ENETUNREACH',
	'ENETDOWN',
	'ENETRESET',
	'EAGAIN',
	'EINTR',
	'EALREADY',
	'EINPROGRESS',
	'EWOULDBLOCK',
	'ENOBUFS',
	'EADDRNOTAVAIL',
	'ECONNREFUSED',
	'ECONNRESET',
	'ECONNABORTED',
	'EPIPE',
	'EBADF',
	'EIO',
	'ECANCELED',
	'ETIMEDOUT',
	'EAI_AGAIN',
	'EAI_FAIL',
	'EAI_SYSTEM',
	'EAI_NONAME',
	'EAI_NODATA',
	'ENOTFOUND',
	'ERR_SOCKET_DGRAM_NOT_RUNNING',
	'ERR_SOCKET_CLOSED'
]);

function isTransientNetworkError(error) {
	error = normalizeNetworkError(error);

	if (!error) return false;

	if (TRANSIENT_NETWORK_ERROR_CODES.has(error.code)) {
		return true;
	}

	return (
		typeof error.message === 'string' &&
		error.message.includes('Network communication is unavailable')
	);
}

function normalizeNetworkError(error) {
	if (!error) return error;

	if (typeof error.code === 'string') {
		error.code = canonicalizeErrorCode(error.code);
		return error;
	}

	if (typeof error.errno === 'string') {
		error.code = canonicalizeErrorCode(error.errno);
		return error;
	}

	if (typeof error.errno === 'number' && typeof util.getSystemErrorName === 'function') {
		try {
			error.code = util.getSystemErrorName(error.errno);
			return error;
		} catch (err) {
			// fall through
		}
	}

	if (error.cause && error.cause !== error) {
		const nested = normalizeNetworkError(error.cause);
		if (nested && typeof nested.code === 'string') {
			error.code = nested.code;
		}
	}

	return error;
}

function canonicalizeErrorCode(code) {
	if (typeof code !== 'string') return code;

	if (TRANSIENT_NETWORK_ERROR_CODES.has(code)) {
		return code;
	}

	const upper = code.toUpperCase();
	if (TRANSIENT_NETWORK_ERROR_CODES.has(upper)) {
		return upper;
	}

	const lower = code.toLowerCase();
	if (TRANSIENT_NETWORK_ERROR_CODES.has(lower)) {
		return lower;
	}

	return upper;
}

module.exports = {
	TRANSIENT_NETWORK_ERROR_CODES,
	normalizeNetworkError,
	isTransientNetworkError
};
