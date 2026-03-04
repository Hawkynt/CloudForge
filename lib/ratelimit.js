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

// Matches: "resets 1am", "resets Mar 9, 11am", "resets Mar 9, 11am (Europe/Berlin)", "resets 11:00 PM"
const ABSOLUTE_TIME_REGEX = /resets?\s+(?:([A-Za-z]+)\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i;

const MONTH_MAP = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

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
  const monthName = match[1] || null;
  const dayStr = match[2] || null;
  let hours = parseInt(match[3], 10);
  const minutes = match[4] ? parseInt(match[4], 10) : 0;
  const meridiem = match[5].toLowerCase();
  const timezone = match[6] || null;

  if (meridiem === 'am' && hours === 12) hours = 0;
  else if (meridiem === 'pm' && hours !== 12) hours += 12;

  const monthIndex = monthName ? MONTH_MAP[monthName.toLowerCase()] : null;
  const day = dayStr ? parseInt(dayStr, 10) : null;

  if (timezone)
    return secondsUntilTimeInTimezone(hours, minutes, monthIndex, day, timezone);

  const now = new Date();
  const reset = new Date(now);

  if (monthIndex !== null && day !== null) {
    reset.setMonth(monthIndex, day);
    reset.setHours(hours, minutes, 0, 0);
    // If the explicit date is in the past, assume next year
    if (reset <= now)
      reset.setFullYear(reset.getFullYear() + 1);
  } else {
    reset.setHours(hours, minutes, 0, 0);
    // If reset time is in the past, it means tomorrow
    if (reset <= now)
      reset.setDate(reset.getDate() + 1);
  }

  return Math.max(1, Math.ceil((reset - now) / 1000));
}

function secondsUntilTimeInTimezone(hours, minutes, monthIndex, day, timezone) {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false,
    });
    const parts = {};
    for (const p of fmt.formatToParts(now))
      parts[p.type] = parseInt(p.value, 10);

    const nowInTz = {
      year: parts.year,
      month: parts.month - 1,
      day: parts.day,
      hours: parts.hour === 24 ? 0 : parts.hour,
      minutes: parts.minute,
      seconds: parts.second,
    };

    const targetMonth = monthIndex !== null && monthIndex !== undefined ? monthIndex : nowInTz.month;
    const targetDay = day !== null && day !== undefined ? day : nowInTz.day;

    // Seconds since midnight for both "now in tz" and the target time
    const nowSec = nowInTz.hours * 3600 + nowInTz.minutes * 60 + nowInTz.seconds;
    const targetSec = hours * 3600 + minutes * 60;

    // Build a Date in the target timezone's wall-clock for comparison
    const nowDate = new Date(nowInTz.year, nowInTz.month, nowInTz.day);
    const targetDate = new Date(nowInTz.year, targetMonth, targetDay);

    let diffDays = Math.round((targetDate - nowDate) / 86400000);
    let diffSec = diffDays * 86400 + (targetSec - nowSec);

    if (diffSec <= 0) {
      if (monthIndex !== null && day !== null)
        diffSec += 365 * 86400; // next year
      else
        diffSec += 86400; // tomorrow
    }

    return Math.max(1, diffSec);
  } catch (_) {
    // Invalid timezone — fall back to local time calculation
    const now = new Date();
    const reset = new Date(now);

    if (monthIndex !== null && day !== null) {
      reset.setMonth(monthIndex, day);
      reset.setHours(hours, minutes, 0, 0);
      if (reset <= now)
        reset.setFullYear(reset.getFullYear() + 1);
    } else {
      reset.setHours(hours, minutes, 0, 0);
      if (reset <= now)
        reset.setDate(reset.getDate() + 1);
    }

    return Math.max(1, Math.ceil((reset - now) / 1000));
  }
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
  secondsUntilTimeInTimezone,
  computeBackoff,
  waitWithCountdown,
  handleRateLimit,
  RATE_LIMIT_PATTERNS,
  RETRY_AFTER_PATTERNS,
  ABSOLUTE_TIME_REGEX,
  MONTH_MAP,
  RATE_LIMIT_BUFFER_SECONDS,
};
