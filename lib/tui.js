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

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) { return str.replace(ANSI_REGEX, ''); }

function getTermWidth() { return process.stdout.columns || 80; }

function padLine(str, width) {
  const visible = stripAnsi(str).length;
  if (visible >= width) {
    // Truncate: walk the string keeping track of visible chars
    let vis = 0;
    let i = 0;
    const limit = width - 3;
    while (i < str.length && vis < limit) {
      if (str[i] === '\x1b') {
        const end = str.indexOf('m', i);
        if (end !== -1) { i = end + 1; continue; }
      }
      ++vis;
      ++i;
    }
    return str.slice(0, i) + '...' + RESET;
  }
  return str + ' '.repeat(width - visible);
}

// Box-drawing characters
const BOX = { tl: '\u250C', tr: '\u2510', bl: '\u2514', br: '\u2518', h: '\u2500', v: '\u2502' };

function box(title, lines, options = {}) {
  const width = options.width || getTermWidth();
  const borderColor = options.borderColor || DIM;
  const padding = options.padding != null ? options.padding : 1;
  const pad = ' '.repeat(padding);
  const innerWidth = width - 2; // inside the vertical bars
  const contentWidth = innerWidth - padding * 2;

  const bc = borderColor;
  const parts = [];

  // Top border with title
  if (title) {
    const titleStr = ` ${title} `;
    const titleVisLen = stripAnsi(titleStr).length;
    const remaining = innerWidth - 1 - titleVisLen; // 1 for the dash after corner
    parts.push(`${bc}${BOX.tl}${BOX.h}${RESET}${titleStr}${bc}${BOX.h.repeat(Math.max(0, remaining))}${BOX.tr}${RESET}`);
  } else {
    parts.push(`${bc}${BOX.tl}${BOX.h.repeat(innerWidth)}${BOX.tr}${RESET}`);
  }

  // Content lines
  for (const line of lines) {
    const padded = padLine(`${pad}${line}`, innerWidth);
    parts.push(`${bc}${BOX.v}${RESET}${padded}${bc}${BOX.v}${RESET}`);
  }

  // Bottom border
  parts.push(`${bc}${BOX.bl}${BOX.h.repeat(innerWidth)}${BOX.br}${RESET}`);

  return parts.join('\n');
}

function dashboardBar(current, total, width = 20, colorCode = GREEN) {
  if (total <= 0) return `[${' '.repeat(width)}]`;
  const pct = Math.min(1, current / total);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  if (filled === 0) return `[${' '.repeat(width)}]`;
  const cursor = filled < width ? '>' : '=';
  const bar = '='.repeat(Math.max(0, filled - 1)) + cursor;
  return `[${colorCode}${bar}${RESET}${' '.repeat(Math.max(0, empty))}]`;
}

const PHASE_GROUPS = [
  { label: 'Discovery', phases: ['DISCOVER', 'REQUIREMENTS', 'PRIORITIZE', 'GATE_SCOPE'] },
  { label: 'Design', phases: ['DOMAIN', 'DESIGN', 'BDD', 'PLAN', 'PROTOTYPE', 'GATE_DESIGN'] },
  { label: 'Task Loop', phases: ['TEST', 'IMPLEMENT', 'VERIFY', 'REFACTOR'] },
  { label: 'Integration', phases: ['INTEGRATE', 'GATE_QUALITY', 'REVIEW', 'INNOVATE'] },
];

// Track whether the cursor is at the start of a new line.
// Used to ensure structured output (tool calls, banners) starts on its own line.
let _atLineStart = true;

function ensureNewline() {
  if (!_atLineStart) {
    process.stdout.write('\n');
    _atLineStart = true;
  }
}

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

function banner(task, model, maxIterations, options = {}) {
  const ts = timestamp();
  const content = [
    `${BOLD}${MAGENTA}Autonomous Development Orchestrator${RESET}`,
    '',
    `${DIM}Task:${RESET}     ${task}`,
    `${DIM}Model:${RESET}    ${model}`,
    `${DIM}Budget:${RESET}   ${maxIterations} iterations`,
    `${DIM}Started:${RESET}  ${ts}`,
  ];
  if (options.isResume)
    content.push(`${DIM}Resumed:${RESET}  at iteration ${options.iteration || 0}`);
  process.stdout.write('\n' + box(`${BOLD}${MAGENTA}CLOUDFORGE${RESET}`, content) + '\n');
}

function phaseBanner(phaseName, subTask, totalSubTasks, iteration, maxIterations, tokens, sessionStart) {
  const phaseStr = color.bold(color.cyan(phaseName));
  const subTaskStr = (subTask != null && totalSubTasks != null)
    ? ` ${DIM}(sub-task ${subTask}/${totalSubTasks})${RESET}`
    : '';

  const tokenIn = tokens?.input ? formatTokenCount(tokens.input) : '0';
  const tokenOut = tokens?.output ? formatTokenCount(tokens.output) : '0';

  const start = sessionStart || 0;
  const sessionIter = iteration - start;
  const sessionBudget = maxIterations - start;

  const content = [
    `${DIM}Iteration:${RESET} ${sessionIter}/${sessionBudget} (total: ${iteration})  ${DIM}|${RESET}  ${DIM}Tokens:${RESET} ${tokenIn} / ${tokenOut}`,
  ];
  const title = `${BOLD}Phase:${RESET} ${phaseStr}${subTaskStr}`;
  process.stdout.write('\n' + box(title, content) + '\n');
}

function phaseProgressLine(allPhases, completedPhases, currentPhase) {
  const segments = [];
  for (const group of PHASE_GROUPS) {
    const doneCount = group.phases.filter(p => completedPhases.includes(p)).length;
    const isActive = group.phases.includes(currentPhase);
    const allDone = doneCount === group.phases.length;

    const markers = group.phases.map(p => {
      if (completedPhases.includes(p)) return '#';
      if (p === currentPhase) return '>';
      return '-';
    }).join('');

    let labelColor, barColor;
    if (allDone) { labelColor = GREEN; barColor = GREEN; }
    else if (isActive) { labelColor = CYAN; barColor = YELLOW; }
    else { labelColor = DIM; barColor = DIM; }

    segments.push(`${labelColor}${group.label}${RESET} ${DIM}[${RESET}${barColor}${markers}${RESET}${DIM}]${RESET}`);
  }

  const idx = allPhases.indexOf(currentPhase);
  const total = allPhases.length;
  const position = idx >= 0 ? `phase ${idx + 1}/${total}` : `phase ?/${total}`;

  process.stdout.write(`  ${segments.join('  ')}  ${DIM}${position}${RESET}\n`);

  // Show current phase pointer
  if (currentPhase) {
    let offset = 2; // leading spaces
    for (const group of PHASE_GROUPS) {
      const labelLen = group.label.length + 2; // label + space + [
      if (group.phases.includes(currentPhase)) {
        const phaseIdx = group.phases.indexOf(currentPhase);
        offset += labelLen + phaseIdx;
        const pointer = ' '.repeat(offset) + `${YELLOW}^ ${currentPhase}${RESET}`;
        process.stdout.write(pointer + '\n');
        break;
      }
      offset += labelLen + group.phases.length + 3; // ] + two spaces
    }
  }
}

function completedPhasesList(phases) {
  if (!phases.length) return;
  const ts = timestamp();
  const chain = phases.map((p) => `${GREEN}\u2713${RESET} ${color.green(p)}`).join(color.dim(' -> '));
  process.stdout.write(`\n${DIM}[${ts}] Completed:${RESET} ${chain}\n`);
}

function toolCallLine(toolName, args) {
  ensureNewline();
  const truncated = args.length > 80 ? args.slice(0, 77) + '...' : args;
  process.stdout.write(`  ${color.dim('[')}${color.yellow(toolName)}${color.dim(']')} ${truncated}\n`);
}

function streamText(text) {
  process.stdout.write(text);
  if (text.length > 0)
    _atLineStart = text[text.length - 1] === '\n';
}

function statusLine(text) {
  process.stdout.write(`${CLEAR_LINE}\r${DIM} ${text}${RESET}`);
}

function newline() {
  process.stdout.write('\n');
}

function rateLimitBanner(retryAfter, attempt, maxAttempts) {
  const content = [
    `${DIM}Waiting for token refresh${RESET}`,
    `${DIM}Retry in:${RESET}  ${formatTime(retryAfter)}  ${DIM}(attempt ${attempt}/${maxAttempts})${RESET}`,
  ];
  process.stdout.write('\n' + box(`${BG_RED} RATE LIMITED ${RESET}`, content) + '\n');
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
  process.stdout.write(`\n${DIM}[${ts}]${RESET} ${RED}\u2717 ${BOLD}ERROR:${RESET} ${RED}${msg}${RESET}\n`);
}

function warnMessage(msg) {
  const ts = timestamp();
  process.stdout.write(`\n${DIM}[${ts}]${RESET} ${YELLOW}\u26A0 ${BOLD}WARN:${RESET} ${YELLOW}${msg}${RESET}\n`);
}

function successMessage(msg) {
  const ts = timestamp();
  process.stdout.write(`\n${DIM}[${ts}]${RESET} ${GREEN}\u2713 ${BOLD}DONE:${RESET} ${GREEN}${msg}${RESET}\n`);
}

function haltMessage(reason) {
  const content = [
    '',
    `${RED}Reason:${RESET} ${reason}`,
    '',
    `${DIM}State saved to .cloudforge/state.json${RESET}`,
    `${DIM}Re-run without arguments to auto-resume${RESET}`,
    '',
  ];
  process.stdout.write('\n' + box(`${BG_RED} HALTED ${RESET}`, content) + '\n');
}

function dryRunSummary(phases) {
  const content = phases.map((p, i) =>
    `${DIM}${String(i + 1).padStart(2)}.${RESET} ${CYAN}${p}${RESET}`
  );
  process.stdout.write('\n' + box(`${BOLD}${CYAN}DRY RUN - Planned Phases${RESET}`, content) + '\n');
}

function finalSummary(state) {
  const elapsed = state.startedAt
    ? formatTime(Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000))
    : 'unknown';
  const sessionIters = state.iteration - (state.sessionStartIteration || 0);

  // Compute KPIs from history
  const history = state.history || [];
  const completedCount = (state.completedPhases || []).length;
  let doneCount = 0, retryCount = 0, blockedCount = 0;
  for (const h of history) {
    if (h.result === 'DONE') ++doneCount;
    else if (h.result === 'NEEDS_RETRY') ++retryCount;
    else if (h.result === 'BLOCKED') ++blockedCount;
  }
  const totalResults = doneCount + retryCount + blockedCount;
  const successRate = totalResults > 0 ? Math.round((doneCount / totalResults) * 100) : 0;

  const content = [
    '',
    `${DIM}Task:${RESET}         ${state.task}`,
    `${DIM}Duration:${RESET}     ${elapsed}`,
    `${DIM}Iterations:${RESET}   ${state.iteration}/${state.maxIterations} (session: ${sessionIters})`,
    `${DIM}Tokens:${RESET}       ${formatTokenCount(state.totalTokens?.input || 0)} in / ${formatTokenCount(state.totalTokens?.output || 0)} out`,
    '',
    `${DIM}Phases:${RESET}       ${completedCount}/18 completed`,
    `${DIM}Sub-tasks:${RESET}    ${state.currentSubTask || 0}/${state.totalSubTasks || 0} done`,
    `${DIM}Results:${RESET}      ${GREEN}DONE ${doneCount}${RESET}  ${DIM}|${RESET}  ${YELLOW}RETRY ${retryCount}${RESET}  ${DIM}|${RESET}  ${RED}BLOCKED ${blockedCount}${RESET}`,
    `${DIM}Success rate:${RESET} ${successRate}%`,
    '',
  ];
  process.stdout.write('\n' + box(`${BOLD}${GREEN}CLOUDFORGE COMPLETE${RESET}`, content) + '\n');
}

function phaseResultBox(phaseName, result, summary, tokensUsed, nextPhase) {
  let resultColor, resultIcon;
  if (result === 'DONE') { resultColor = GREEN; resultIcon = '\u2713'; }
  else if (result === 'NEEDS_RETRY') { resultColor = YELLOW; resultIcon = '\u21BB'; }
  else { resultColor = RED; resultIcon = '\u2717'; }

  const tokenIn = tokensUsed?.input ? formatTokenCount(tokensUsed.input) : '0';
  const tokenOut = tokensUsed?.output ? formatTokenCount(tokensUsed.output) : '0';

  const nextStr = nextPhase
    ? `${DIM}Next${RESET} ${DIM}->${RESET} ${CYAN}${nextPhase}${RESET}`
    : `${GREEN}COMPLETE${RESET}`;

  const content = [
    `${BOLD}${phaseName}${RESET}  ${resultColor}${result} ${resultIcon}${RESET}`,
  ];
  if (summary)
    content.push(`${DIM}${summary}${RESET}`);
  content.push(`${DIM}Tokens:${RESET} ${tokenIn} in / ${tokenOut} out  ${DIM}|${RESET}  ${nextStr}`);

  process.stdout.write(box(`${BOLD}Result${RESET}`, content) + '\n');
}

function kpiDashboard(wfState, lastResult, allPhaseNames) {
  const phaseIdx = allPhaseNames ? allPhaseNames.indexOf(wfState.phase) + 1 : 0;
  const totalPhases = allPhaseNames ? allPhaseNames.length : 18;

  const iteration = wfState.iteration || 0;
  const maxIter = wfState.maxIterations || 100;
  const sessionStart = wfState.sessionStartIteration || 0;
  const sessionIter = iteration - sessionStart;

  // Iteration bar color: green <50%, yellow 50-80%, red >80%
  const iterPct = maxIter > 0 ? iteration / maxIter : 0;
  let iterColor = GREEN;
  if (iterPct > 0.8) iterColor = RED;
  else if (iterPct >= 0.5) iterColor = YELLOW;

  const tokenIn = formatTokenCount(wfState.totalTokens?.input || 0);
  const tokenOut = formatTokenCount(wfState.totalTokens?.output || 0);

  // Elapsed time
  let elapsedStr = '--';
  if (wfState.startedAt) {
    const secs = Math.round((Date.now() - new Date(wfState.startedAt).getTime()) / 1000);
    elapsedStr = formatTime(secs);
  }

  // Retry indicator
  const retries = wfState.consecutiveRetries || 0;
  let retryColor = GREEN, retryLabel = 'healthy';
  if (retries >= 2) { retryColor = RED; retryLabel = `${retries} consecutive`; }
  else if (retries === 1) { retryColor = YELLOW; retryLabel = '1 retry'; }

  // Last result indicator
  let lastStr = `${DIM}--${RESET}`;
  if (lastResult?.result === 'DONE') lastStr = `${GREEN}DONE \u2713${RESET}`;
  else if (lastResult?.result === 'NEEDS_RETRY') lastStr = `${YELLOW}NEEDS_RETRY \u21BB${RESET}`;
  else if (lastResult?.result === 'BLOCKED') lastStr = `${RED}BLOCKED \u2717${RESET}`;

  const content = [
    `${DIM}Phase${RESET}      ${dashboardBar(phaseIdx, totalPhases, 20, CYAN)} ${phaseIdx}/${totalPhases}  ${CYAN}${wfState.phase || ''}${RESET}`,
  ];

  const totalSubs = wfState.totalSubTasks || 0;
  if (totalSubs > 0) {
    const curSub = wfState.currentSubTask || 0;
    content.push(`${DIM}Sub-task${RESET}   ${dashboardBar(curSub, totalSubs, 20, MAGENTA)} ${curSub}/${totalSubs}`);
  }

  content.push(
    `${DIM}Iteration${RESET}  ${dashboardBar(iteration, maxIter, 20, iterColor)} ${iteration}/${maxIter} ${DIM}(sess: ${sessionIter})${RESET}`,
    `${DIM}Tokens${RESET}     ${tokenIn} in / ${tokenOut} out`,
    `${DIM}Elapsed${RESET}    ${elapsedStr}`,
    `${DIM}Retries${RESET}    ${retryColor}\u25CF${RESET} ${retryLabel}`,
    `${DIM}Last${RESET}       ${lastStr}`,
  );

  process.stdout.write(box(`${BOLD}Dashboard${RESET}`, content) + '\n');
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
  phaseProgressLine,
  completedPhasesList,
  toolCallLine,
  streamText,
  ensureNewline,
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
  stripAnsi,
  getTermWidth,
  padLine,
  box,
  dashboardBar,
  PHASE_GROUPS,
  phaseResultBox,
  kpiDashboard,
};
