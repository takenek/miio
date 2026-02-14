'use strict';

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
	if (!error) return false;

	if (TRANSIENT_NETWORK_ERROR_CODES.has(error.code)) {
		return true;
	}

	return (
		typeof error.message === 'string' &&
		error.message.includes('Network communication is unavailable')
	);
}

module.exports = {
	TRANSIENT_NETWORK_ERROR_CODES,
	isTransientNetworkError
};
