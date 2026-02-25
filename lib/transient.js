'use strict';

const TRANSIENT_ERROR_PATTERNS = [
  { pattern: /\b500\b.*(?:internal|server|error)/i, reason: 'HTTP 500 Internal Server Error' },
  { pattern: /\b502\b.*(?:bad gateway)/i, reason: 'HTTP 502 Bad Gateway' },
  { pattern: /\b503\b.*(?:service|unavailable)/i, reason: 'HTTP 503 Service Unavailable' },
  { pattern: /internal server error/i, reason: 'Internal Server Error' },
  { pattern: /service unavailable/i, reason: 'Service Unavailable' },
  { pattern: /bad gateway/i, reason: 'Bad Gateway' },
  { pattern: /ECONNRESET/i, reason: 'Connection reset' },
  { pattern: /ETIMEDOUT/i, reason: 'Connection timed out' },
  { pattern: /ECONNREFUSED/i, reason: 'Connection refused' },
];

function detectTransientError(exitCode, stderr, output) {
  if (exitCode === 0) return null;
  const combined = `${stderr || ''} ${output || ''}`;
  for (const { pattern, reason } of TRANSIENT_ERROR_PATTERNS) {
    if (pattern.test(combined))
      return { reason };
  }
  return null;
}

module.exports = {
  TRANSIENT_ERROR_PATTERNS,
  detectTransientError,
};
