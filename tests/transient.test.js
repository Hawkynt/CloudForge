'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { detectTransientError } = require('../lib/transient');

describe('transient', () => {
  describe('detectTransientError', () => {
    it('returns null for exit code 0 even with error text in output', () => {
      const result = detectTransientError(0, '500 Internal Server Error', 'service unavailable');
      assert.equal(result, null);
    });

    it('returns null for normal errors (TypeError)', () => {
      const result = detectTransientError(1, 'TypeError: undefined is not a function', '');
      assert.equal(result, null);
    });

    it('returns null for normal errors (SyntaxError)', () => {
      const result = detectTransientError(1, 'SyntaxError: Unexpected token', '');
      assert.equal(result, null);
    });

    it('detects 500 Internal Server Error in stderr', () => {
      const result = detectTransientError(1, 'Error: 500 Internal Server Error', '');
      assert.notEqual(result, null);
      assert.equal(result.reason, 'HTTP 500 Internal Server Error');
    });

    it('detects 503 Service Unavailable in stderr', () => {
      const result = detectTransientError(1, 'Error: 503 Service Unavailable', '');
      assert.notEqual(result, null);
      assert.equal(result.reason, 'HTTP 503 Service Unavailable');
    });

    it('detects 502 Bad Gateway in output', () => {
      const result = detectTransientError(1, '', 'Response: 502 Bad Gateway');
      assert.notEqual(result, null);
      assert.equal(result.reason, 'HTTP 502 Bad Gateway');
    });

    it('detects ECONNRESET in stderr', () => {
      const result = detectTransientError(1, 'Error: read ECONNRESET', '');
      assert.notEqual(result, null);
      assert.equal(result.reason, 'Connection reset');
    });

    it('detects ETIMEDOUT in stderr', () => {
      const result = detectTransientError(1, 'Error: connect ETIMEDOUT 10.0.0.1:443', '');
      assert.notEqual(result, null);
      assert.equal(result.reason, 'Connection timed out');
    });

    it('detects ECONNREFUSED in stderr', () => {
      const result = detectTransientError(1, 'Error: connect ECONNREFUSED 127.0.0.1:3000', '');
      assert.notEqual(result, null);
      assert.equal(result.reason, 'Connection refused');
    });

    it('detects case-insensitive "internal server error"', () => {
      const result = detectTransientError(1, '', 'INTERNAL SERVER ERROR occurred');
      assert.notEqual(result, null);
      assert.equal(result.reason, 'Internal Server Error');
    });

    it('returns first matching reason when multiple patterns match', () => {
      const result = detectTransientError(1, '500 Internal Server Error service unavailable ECONNRESET', '');
      assert.notEqual(result, null);
      assert.equal(result.reason, 'HTTP 500 Internal Server Error');
    });

    it('handles null stderr and output', () => {
      const result = detectTransientError(1, null, null);
      assert.equal(result, null);
    });
  });
});
