'use strict';

const tui = require('./tui');

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /429/,
  /too many requests/i,
  /overloaded/i,
  /capacity/i,
  /throttl/i,
  /hit\s+(your|the)\s+limit/i,
  /you've hit.*limit/i,
  /limit.*resets?\b/i,
];

const RETRY_AFTER_PATTERNS = [
  /retry.?after\D*(\d+)/i,
  /try again in\s*(\d+)/i,
  /wait\s*(\d+)\s*second/i,
  /(\d+)\s*seconds?\s*(?:before|until)/i,
];

// Matches absolute reset times like "resets 1am", "resets 1:30am", "resets 1:00 AM"
const ABSOLUTE_TIME_REGEX = /resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

function detectRateLimit(exitCode, stderr, output) {
  const combined = `${stderr || ''} ${output || ''}`;

  if (exitCode !== 0) {
    for (const pat of RATE_LIMIT_PATTERNS) {
      if (pat.test(combined))
        return { isRateLimit: true, retryAfter: extractRetryAfter(combined) };
    }
  }

  // Also check output for embedded rate limit errors (stream-json error events)
  for (const pat of RATE_LIMIT_PATTERNS) {
    if (pat.test(output || ''))
      return { isRateLimit: true, retryAfter: extractRetryAfter(combined) };
  }

  return { isRateLimit: false, retryAfter: 0 };
}

function extractRetryAfter(text) {
  // Check duration-based patterns first (seconds)
  for (const pat of RETRY_AFTER_PATTERNS) {
    const m = text.match(pat);
    if (m) return parseInt(m[1], 10);
  }

  // Check for absolute reset time like "resets 1am" / "resets 1:30 PM"
  const absMatch = text.match(ABSOLUTE_TIME_REGEX);
  if (absMatch) return parseAbsoluteResetTime(absMatch);

  return 0;
}

function parseAbsoluteResetTime(match) {
  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3].toLowerCase();

  if (meridiem === 'am' && hours === 12) hours = 0;
  else if (meridiem === 'pm' && hours !== 12) hours += 12;

  const now = new Date();
  const reset = new Date(now);
  reset.setHours(hours, minutes, 0, 0);

  // If reset time is in the past, it means tomorrow
  if (reset <= now)
    reset.setDate(reset.getDate() + 1);

  return Math.max(1, Math.ceil((reset - now) / 1000));
}

function computeBackoff(attempt, maxWait) {
  const base = 60 * Math.pow(2, attempt);
  return Math.min(base, maxWait);
}

function waitWithCountdown(seconds) {
  return new Promise((resolve) => {
    const totalSeconds = seconds;
    let remaining = seconds;

    const interval = setInterval(() => {
      --remaining;
      tui.countdownUpdate(remaining, totalSeconds);

      if (remaining <= 0) {
        clearInterval(interval);
        tui.newline();
        resolve();
      }
    }, 1000);

    // Initial render
    tui.countdownUpdate(remaining, totalSeconds);
  });
}

const RATE_LIMIT_BUFFER_SECONDS = 30;

async function handleRateLimit(retryAfterHint, attempt, maxAttempts, maxWaitTotal) {
  const baseWait = retryAfterHint > 0
    ? retryAfterHint
    : computeBackoff(attempt, maxWaitTotal);

  // Add buffer to ensure tokens are actually available when we retry
  const waitTime = retryAfterHint > 0
    ? baseWait + RATE_LIMIT_BUFFER_SECONDS
    : baseWait;

  tui.rateLimitBanner(waitTime, attempt + 1, maxAttempts);
  await waitWithCountdown(waitTime);
  return true;
}

module.exports = {
  detectRateLimit,
  extractRetryAfter,
  parseAbsoluteResetTime,
  computeBackoff,
  waitWithCountdown,
  handleRateLimit,
  RATE_LIMIT_PATTERNS,
  RETRY_AFTER_PATTERNS,
  ABSOLUTE_TIME_REGEX,
  RATE_LIMIT_BUFFER_SECONDS,
};
