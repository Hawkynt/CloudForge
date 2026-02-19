'use strict';

const fs = require('fs');
const path = require('path');

const CLOUDFORGE_DIR = '.cloudforge';
const STATE_FILE = 'state.json';
const PLAN_FILE = 'plan.md';

function createInitialState(task, options = {}) {
  return {
    sessionId: null,
    task,
    phase: options.initialPhase || 'DISCOVER',
    currentSubTask: 0,
    totalSubTasks: 0,
    iteration: 0,
    maxIterations: options.maxIterations || 25,
    maxPhaseRetries: options.maxPhaseRetries || 3,
    model: options.model || null,
    totalTokens: { input: 0, output: 0 },
    history: [],
    completedPhases: [],
    consecutiveRetries: 0,
    lastErrors: [],
    startedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}

function getCloudForgeDir(workingDir) {
  return path.join(workingDir, CLOUDFORGE_DIR);
}

function getStatePath(workingDir) {
  return path.join(workingDir, CLOUDFORGE_DIR, STATE_FILE);
}

function getPlanPath(workingDir) {
  return path.join(workingDir, CLOUDFORGE_DIR, PLAN_FILE);
}

function ensureCloudForgeDir(workingDir) {
  const dir = getCloudForgeDir(workingDir);
  if (!fs.existsSync(dir))
    fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveState(workingDir, state) {
  ensureCloudForgeDir(workingDir);
  const filePath = getStatePath(workingDir);
  state.lastActivity = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function loadState(workingDir) {
  const filePath = getStatePath(workingDir);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function loadPlan(workingDir) {
  const filePath = getPlanPath(workingDir);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function recordIteration(state, phase, result, tokens) {
  ++state.iteration;
  state.lastActivity = new Date().toISOString();

  state.history.push({
    iteration: state.iteration,
    phase,
    result: result?.result || 'UNKNOWN',
    summary: result?.summary || '',
    tokens: (tokens?.input || 0) + (tokens?.output || 0),
  });

  state.totalTokens.input += tokens?.input || 0;
  state.totalTokens.output += tokens?.output || 0;
}

function trackRetry(state, phase, errorMsg) {
  const result = state.history.length > 0 ? state.history[state.history.length - 1]?.result : null;

  if (result === 'NEEDS_RETRY') {
    ++state.consecutiveRetries;
  } else {
    state.consecutiveRetries = 0;
  }

  if (errorMsg) {
    state.lastErrors.push(errorMsg);
    if (state.lastErrors.length > 5)
      state.lastErrors.shift();
  }
}

function markPhaseCompleted(state, phaseName) {
  if (!state.completedPhases.includes(phaseName))
    state.completedPhases.push(phaseName);
  state.consecutiveRetries = 0;
}

// Circuit breaker checks

function checkMaxIterations(state) {
  if (state.iteration >= state.maxIterations)
    return { halt: true, reason: `Max iterations reached (${state.maxIterations})` };
  return { halt: false };
}

function checkConsecutiveRetries(state, threshold = 3) {
  if (state.consecutiveRetries >= threshold)
    return { halt: true, reason: `${state.consecutiveRetries} consecutive retries with no progress - possible stuck loop` };
  return { halt: false };
}

function checkRepeatedErrors(state, threshold = 3) {
  if (state.lastErrors.length < threshold) return { halt: false };

  const recent = state.lastErrors.slice(-threshold);
  const allSame = recent.every((e) => e === recent[0]);
  if (allSame)
    return { halt: true, reason: `Same error repeated ${threshold} times: "${recent[0]}"` };
  return { halt: false };
}

function checkCircuitBreaker(state) {
  const checks = [
    checkMaxIterations(state),
    checkConsecutiveRetries(state),
    checkRepeatedErrors(state),
  ];

  for (const check of checks) {
    if (check.halt) return check;
  }
  return { halt: false };
}

module.exports = {
  createInitialState,
  getCloudForgeDir,
  getStatePath,
  getPlanPath,
  ensureCloudForgeDir,
  saveState,
  loadState,
  loadPlan,
  recordIteration,
  trackRetry,
  markPhaseCompleted,
  checkMaxIterations,
  checkConsecutiveRetries,
  checkRepeatedErrors,
  checkCircuitBreaker,
  CLOUDFORGE_DIR,
  STATE_FILE,
  PLAN_FILE,
};
