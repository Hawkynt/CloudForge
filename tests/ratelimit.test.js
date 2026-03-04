'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const rl = require('../lib/ratelimit');

describe('ratelimit', () => {
  describe('detectRateLimit', () => {
    it('detects rate limit from stderr with 429', () => {
      const result = rl.detectRateLimit(1, 'Error: 429 Too Many Requests', '');
      assert.equal(result.isRateLimit, true);
    });

    it('detects rate limit from stderr with rate_limit keyword', () => {
      const result = rl.detectRateLimit(1, 'rate_limit_error: exceeded', '');
      assert.equal(result.isRateLimit, true);
    });

    it('detects rate limit from output text', () => {
      const result = rl.detectRateLimit(0, '', 'Error: too many requests, please slow down');
      assert.equal(result.isRateLimit, true);
    });

    it('detects overloaded error', () => {
      const result = rl.detectRateLimit(1, 'API is overloaded', '');
      assert.equal(result.isRateLimit, true);
    });

    it('detects throttling', () => {
      const result = rl.detectRateLimit(1, 'Request throttled', '');
      assert.equal(result.isRateLimit, true);
    });

    it('returns false for normal errors', () => {
      const result = rl.detectRateLimit(1, 'TypeError: undefined is not a function', '');
      assert.equal(result.isRateLimit, false);
    });

    it('returns false for successful exit', () => {
      const result = rl.detectRateLimit(0, '', 'All done');
      assert.equal(result.isRateLimit, false);
    });

    it('returns false for empty inputs', () => {
      const result = rl.detectRateLimit(0, '', '');
      assert.equal(result.isRateLimit, false);
    });

    it('handles null stderr and output', () => {
      const result = rl.detectRateLimit(0, null, null);
      assert.equal(result.isRateLimit, false);
    });
  });

  describe('extractRetryAfter', () => {
    it('extracts retry-after seconds', () => {
      assert.equal(rl.extractRetryAfter('retry-after: 30'), 30);
    });

    it('extracts try again in pattern', () => {
      assert.equal(rl.extractRetryAfter('Please try again in 60 seconds'), 60);
    });

    it('extracts wait N seconds pattern', () => {
      assert.equal(rl.extractRetryAfter('wait 45 seconds before retrying'), 45);
    });

    it('extracts N seconds before pattern', () => {
      assert.equal(rl.extractRetryAfter('10 seconds before next request'), 10);
    });

    it('returns 0 when no pattern matches', () => {
      assert.equal(rl.extractRetryAfter('some random error message'), 0);
    });

    it('returns 0 for empty string', () => {
      assert.equal(rl.extractRetryAfter(''), 0);
    });
  });

  describe('computeBackoff', () => {
    it('starts at 60 seconds for attempt 0', () => {
      assert.equal(rl.computeBackoff(0, 600), 60);
    });

    it('doubles for each attempt', () => {
      assert.equal(rl.computeBackoff(1, 600), 120);
      assert.equal(rl.computeBackoff(2, 600), 240);
    });

    it('caps at maxWait', () => {
      assert.equal(rl.computeBackoff(10, 300), 300);
    });

    it('respects small maxWait', () => {
      assert.equal(rl.computeBackoff(0, 30), 30);
    });
  });

  describe('detectRateLimit with retry-after extraction', () => {
    it('extracts retry-after from combined stderr', () => {
      const result = rl.detectRateLimit(1, 'rate_limit_error: retry-after: 45', '');
      assert.equal(result.isRateLimit, true);
      assert.equal(result.retryAfter, 45);
    });

    it('extracts retry-after from output text', () => {
      const result = rl.detectRateLimit(0, '', 'too many requests. try again in 30 seconds');
      assert.equal(result.isRateLimit, true);
      assert.equal(result.retryAfter, 30);
    });

    it('returns 0 retryAfter when no time found', () => {
      const result = rl.detectRateLimit(1, 'rate limit exceeded', '');
      assert.equal(result.isRateLimit, true);
      assert.equal(result.retryAfter, 0);
    });
  });

  describe('"hit your limit" detection', () => {
    it('detects "you\'ve hit your limit resets 1am"', () => {
      const result = rl.detectRateLimit(1, "you've hit your limit resets 1am", '');
      assert.equal(result.isRateLimit, true);
    });

    it('detects "hit your limit" in output', () => {
      const result = rl.detectRateLimit(0, '', "you've hit your limit resets 2am");
      assert.equal(result.isRateLimit, true);
    });

    it('detects "hit the limit" variant', () => {
      const result = rl.detectRateLimit(1, 'hit the limit', '');
      assert.equal(result.isRateLimit, true);
    });

    it('detects "limit resets" without "hit"', () => {
      const result = rl.detectRateLimit(1, 'Your limit resets at 3am', '');
      assert.equal(result.isRateLimit, true);
    });
  });

  describe('rate limit buffer', () => {
    it('exports RATE_LIMIT_BUFFER_SECONDS as 30', () => {
      assert.equal(rl.RATE_LIMIT_BUFFER_SECONDS, 30);
    });
  });

  describe('absolute reset time parsing', () => {
    it('extracts seconds until reset from "resets 1am"', () => {
      const seconds = rl.extractRetryAfter("you've hit your limit resets 1am");
      assert.ok(seconds > 0, `expected positive seconds, got ${seconds}`);
    });

    it('extracts seconds from "resets 1:30am"', () => {
      const seconds = rl.extractRetryAfter('limit resets 1:30am');
      assert.ok(seconds > 0);
    });

    it('extracts seconds from "resets 11:00 PM"', () => {
      const seconds = rl.extractRetryAfter('limit resets 11:00 PM');
      assert.ok(seconds > 0);
    });

    it('handles 12am (midnight) correctly', () => {
      const match = rl.ABSOLUTE_TIME_REGEX.exec('resets 12am');
      assert.ok(match);
      const seconds = rl.parseAbsoluteResetTime(match);
      assert.ok(seconds > 0);
    });

    it('handles 12pm (noon) correctly', () => {
      const match = rl.ABSOLUTE_TIME_REGEX.exec('resets 12pm');
      assert.ok(match);
      const seconds = rl.parseAbsoluteResetTime(match);
      assert.ok(seconds > 0);
    });

    it('end-to-end: detectRateLimit returns computed wait for absolute time', () => {
      const result = rl.detectRateLimit(1, "you've hit your limit resets 1am", '');
      assert.equal(result.isRateLimit, true);
      assert.ok(result.retryAfter > 0, `expected retryAfter > 0, got ${result.retryAfter}`);
    });
  });

  describe('date+timezone absolute reset time parsing', () => {
    it('regex matches "resets Mar 9, 11am"', () => {
      const match = rl.ABSOLUTE_TIME_REGEX.exec('resets Mar 9, 11am');
      assert.ok(match);
      assert.equal(match[1], 'Mar');
      assert.equal(match[2], '9');
      assert.equal(match[3], '11');
      assert.equal(match[4], undefined);
      assert.equal(match[5], 'am');
      assert.equal(match[6], undefined);
    });

    it('regex matches "resets Mar 9, 11am (Europe/Berlin)"', () => {
      const match = rl.ABSOLUTE_TIME_REGEX.exec('resets Mar 9, 11am (Europe/Berlin)');
      assert.ok(match);
      assert.equal(match[1], 'Mar');
      assert.equal(match[2], '9');
      assert.equal(match[3], '11');
      assert.equal(match[5], 'am');
      assert.equal(match[6], 'Europe/Berlin');
    });

    it('regex matches "resets March 9, 11:30 AM (US/Eastern)"', () => {
      const match = rl.ABSOLUTE_TIME_REGEX.exec('resets March 9, 11:30 AM (US/Eastern)');
      assert.ok(match);
      assert.equal(match[1], 'March');
      assert.equal(match[2], '9');
      assert.equal(match[3], '11');
      assert.equal(match[4], '30');
      assert.equal(match[5], 'AM');
      assert.equal(match[6], 'US/Eastern');
    });

    it('regex still matches time-only "resets 1am" (backward compat)', () => {
      const match = rl.ABSOLUTE_TIME_REGEX.exec('resets 1am');
      assert.ok(match);
      assert.equal(match[1], undefined);
      assert.equal(match[2], undefined);
      assert.equal(match[3], '1');
      assert.equal(match[5], 'am');
    });

    it('parseAbsoluteResetTime with month+day returns positive seconds', () => {
      const match = rl.ABSOLUTE_TIME_REGEX.exec('resets Mar 9, 11am');
      assert.ok(match);
      const seconds = rl.parseAbsoluteResetTime(match);
      assert.ok(seconds > 0, `expected positive seconds, got ${seconds}`);
    });

    it('parseAbsoluteResetTime with timezone returns positive seconds', () => {
      const match = rl.ABSOLUTE_TIME_REGEX.exec('resets Mar 9, 11am (Europe/Berlin)');
      assert.ok(match);
      const seconds = rl.parseAbsoluteResetTime(match);
      assert.ok(seconds > 0, `expected positive seconds, got ${seconds}`);
    });

    it('invalid timezone falls back gracefully (positive seconds, no throw)', () => {
      const match = rl.ABSOLUTE_TIME_REGEX.exec('resets Mar 9, 11am (Fake/Nowhere)');
      assert.ok(match);
      const seconds = rl.parseAbsoluteResetTime(match);
      assert.ok(seconds > 0, `expected positive seconds, got ${seconds}`);
    });

    it('end-to-end: detectRateLimit with full date+timezone message', () => {
      const result = rl.detectRateLimit(
        1,
        "You've hit your limit \u00b7 resets Mar 9, 11am (Europe/Berlin)",
        '',
      );
      assert.equal(result.isRateLimit, true);
      assert.ok(result.retryAfter > 0, `expected retryAfter > 0, got ${result.retryAfter}`);
    });
  });
});
