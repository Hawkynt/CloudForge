'use strict';

// ANSI escape codes - no dependencies needed
const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;
const RED = `${ESC}31m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const BLUE = `${ESC}34m`;
const MAGENTA = `${ESC}35m`;
const CYAN = `${ESC}36m`;
const WHITE = `${ESC}37m`;
const BG_RED = `${ESC}41m`;
const BG_GREEN = `${ESC}42m`;
const BG_BLUE = `${ESC}44m`;
const BG_MAGENTA = `${ESC}45m`;
const CLEAR_LINE = `${ESC}2K`;

function timestamp() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

const color = {
  reset: (s) => `${RESET}${s}${RESET}`,
  bold: (s) => `${BOLD}${s}${RESET}`,
  dim: (s) => `${DIM}${s}${RESET}`,
  italic: (s) => `${ITALIC}${s}${RESET}`,
  red: (s) => `${RED}${s}${RESET}`,
  green: (s) => `${GREEN}${s}${RESET}`,
  yellow: (s) => `${YELLOW}${s}${RESET}`,
  blue: (s) => `${BLUE}${s}${RESET}`,
  magenta: (s) => `${MAGENTA}${s}${RESET}`,
  cyan: (s) => `${CYAN}${s}${RESET}`,
  white: (s) => `${WHITE}${s}${RESET}`,
  bgRed: (s) => `${BG_RED}${WHITE}${BOLD}${s}${RESET}`,
  bgGreen: (s) => `${BG_GREEN}${WHITE}${BOLD}${s}${RESET}`,
  bgBlue: (s) => `${BG_BLUE}${WHITE}${BOLD}${s}${RESET}`,
  bgMagenta: (s) => `${BG_MAGENTA}${WHITE}${BOLD}${s}${RESET}`,
};

function banner(task, model, maxIterations) {
  const ts = timestamp();
  const lines = [
    '',
    `${BOLD}${MAGENTA} CLOUDFORGE ${RESET}${DIM} - Autonomous Development Loop${RESET}  ${DIM}[${ts}]${RESET}`,
    `${DIM} Task:${RESET} ${task}`,
    `${DIM} Model:${RESET} ${model} ${DIM}|${RESET} ${DIM}Max iterations:${RESET} ${maxIterations}`,
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function phaseBanner(phaseName, subTask, totalSubTasks, iteration, maxIterations, tokens) {
  const ts = timestamp();
  const phaseStr = color.bold(color.cyan(phaseName));
  const subTaskStr = (subTask != null && totalSubTasks != null)
    ? ` ${DIM}(sub-task ${subTask}/${totalSubTasks})${RESET}`
    : '';

  const tokenIn = tokens?.input ? formatTokenCount(tokens.input) : '0';
  const tokenOut = tokens?.output ? formatTokenCount(tokens.output) : '0';

  const lines = [
    '',
    `${DIM}[${ts}]${RESET} ${BOLD}Phase:${RESET} ${phaseStr}${subTaskStr}`,
    `${DIM} Iteration:${RESET} ${iteration}/${maxIterations} ${DIM}|${RESET} ${DIM}Tokens:${RESET} ${tokenIn} in / ${tokenOut} out`,
    `${DIM}${'─'.repeat(50)}${RESET}`,
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function completedPhases(phases) {
  if (!phases.length) return;
  const ts = timestamp();
  const chain = phases.map((p) => color.green(p)).join(color.dim(' -> '));
  process.stdout.write(`\n${DIM}[${ts}] Completed:${RESET} ${chain}\n`);
}

function toolCallLine(toolName, args) {
  const truncated = args.length > 80 ? args.slice(0, 77) + '...' : args;
  process.stdout.write(`  ${color.dim('[')}${color.yellow(toolName)}${color.dim(']')} ${truncated}\n`);
}

function streamText(text) {
  process.stdout.write(text);
}

function statusLine(text) {
  process.stdout.write(`${CLEAR_LINE}\r${DIM} ${text}${RESET}`);
}

function newline() {
  process.stdout.write('\n');
}

function rateLimitBanner(retryAfter, attempt, maxAttempts) {
  const ts = timestamp();
  const lines = [
    '',
    `${DIM}[${ts}]${RESET} ${BG_RED} RATE LIMITED ${RESET} ${DIM}Waiting for token refresh${RESET}`,
    `${DIM} Retry in:${RESET} ${formatTime(retryAfter)}  ${DIM}(attempt ${attempt}/${maxAttempts})${RESET}`,
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function countdownUpdate(secondsLeft, totalSeconds) {
  const pct = Math.max(0, 1 - secondsLeft / totalSeconds);
  const barWidth = 30;
  const filled = Math.round(pct * barWidth);
  const empty = barWidth - filled;
  const bar = `${'='.repeat(filled)}>${' '.repeat(Math.max(0, empty - 1))}`;
  const pctStr = Math.round(pct * 100);
  process.stdout.write(`${CLEAR_LINE}\r ${DIM}[${RESET}${GREEN}${bar}${RESET}${DIM}]${RESET} ${pctStr}%  ${DIM}${formatTime(secondsLeft)}${RESET}`);
}

function debug(msg) {
  process.stderr.write(`${DIM}  [dbg] ${msg}${RESET}\n`);
}

function stderrLine(text) {
  process.stderr.write(`${DIM}${YELLOW}  [agent] ${text}${RESET}\n`);
}

function errorMessage(msg) {
  const ts = timestamp();
  process.stdout.write(`\n${DIM}[${ts}]${RESET} ${RED}${BOLD}ERROR:${RESET} ${RED}${msg}${RESET}\n`);
}

function warnMessage(msg) {
  const ts = timestamp();
  process.stdout.write(`\n${DIM}[${ts}]${RESET} ${YELLOW}${BOLD}WARN:${RESET} ${YELLOW}${msg}${RESET}\n`);
}

function successMessage(msg) {
  const ts = timestamp();
  process.stdout.write(`\n${DIM}[${ts}]${RESET} ${GREEN}${BOLD}DONE:${RESET} ${GREEN}${msg}${RESET}\n`);
}

function haltMessage(reason) {
  const ts = timestamp();
  const lines = [
    '',
    `${DIM}[${ts}]${RESET} ${BG_RED} HALTED ${RESET}`,
    `${RED} ${reason}${RESET}`,
    `${DIM} State saved to .cloudforge/state.json - use --continue-session to resume${RESET}`,
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function dryRunSummary(phases) {
  process.stdout.write(`\n${BOLD}${CYAN} DRY RUN - Planned Phases:${RESET}\n\n`);
  for (let i = 0; i < phases.length; ++i)
    process.stdout.write(`  ${color.dim(`${i + 1}.`)} ${color.cyan(phases[i])}\n`);
  process.stdout.write('\n');
}

function finalSummary(state) {
  const elapsed = state.startedAt
    ? formatTime(Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000))
    : 'unknown';
  const lines = [
    '',
    `${DIM}${'='.repeat(50)}${RESET}`,
    `${BOLD}${GREEN} CLOUDFORGE COMPLETE${RESET}`,
    `${DIM} Task:${RESET} ${state.task}`,
    `${DIM} Iterations:${RESET} ${state.iteration}/${state.maxIterations}`,
    `${DIM} Tokens:${RESET} ${formatTokenCount(state.totalTokens?.input || 0)} in / ${formatTokenCount(state.totalTokens?.output || 0)} out`,
    `${DIM} Duration:${RESET} ${elapsed}`,
    `${DIM}${'='.repeat(50)}${RESET}`,
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function progressBar(current, total, width = 20) {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return `[${color.green('='.repeat(filled))}${' '.repeat(empty)}] ${current}/${total}`;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function formatTokenCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

module.exports = {
  color,
  timestamp,
  banner,
  phaseBanner,
  completedPhases,
  toolCallLine,
  streamText,
  statusLine,
  newline,
  debug,
  stderrLine,
  rateLimitBanner,
  countdownUpdate,
  errorMessage,
  warnMessage,
  successMessage,
  haltMessage,
  dryRunSummary,
  finalSummary,
  progressBar,
  formatTime,
  formatTokenCount,
};
