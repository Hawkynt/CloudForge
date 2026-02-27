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

// ── Recovery / Auto-Resume ──

const ARTIFACT_PHASE_MAP = {
  'requirements.md': 'REQUIREMENTS',
  'stories.md': 'REQUIREMENTS',
  'kpis.md': 'PRIORITIZE',
  'domain.md': 'DOMAIN',
  'bdd-scenarios.md': 'BDD',
  'plan.md': 'PLAN',
  'quality-report.md': 'GATE_QUALITY',
  'innovation-log.md': 'INNOVATE',
};

function hasCloudForgeDir(workingDir) {
  const dir = getCloudForgeDir(workingDir);
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

function tryLoadState(workingDir) {
  try {
    const filePath = getStatePath(workingDir);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.task) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractFirstHeading(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function inferTaskFromArtifacts(workingDir) {
  const cfDir = getCloudForgeDir(workingDir);
  if (!fs.existsSync(cfDir)) return null;

  // 1. Try regex from corrupt state.json
  const statePath = getStatePath(workingDir);
  if (fs.existsSync(statePath)) {
    try {
      const raw = fs.readFileSync(statePath, 'utf8');
      const match = raw.match(/"task"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (match) {
        const task = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        if (task) return task;
      }
    } catch { /* ignore */ }
  }

  // 2. First heading from requirements.md
  const reqHeading = extractFirstHeading(path.join(cfDir, 'requirements.md'));
  if (reqHeading) return reqHeading;

  // 3. First heading from stories.md
  const storiesHeading = extractFirstHeading(path.join(cfDir, 'stories.md'));
  if (storiesHeading) return storiesHeading;

  // 4. First PRD file
  const prdDir = path.join(cfDir, 'prd');
  if (fs.existsSync(prdDir) && fs.statSync(prdDir).isDirectory()) {
    const files = fs.readdirSync(prdDir).filter((f) => f.endsWith('.md')).sort();
    if (files.length > 0) {
      const heading = extractFirstHeading(path.join(prdDir, files[0]));
      if (heading) return heading;
    }
  }

  return null;
}

function inferCompletedPhases(workingDir, orderedPhaseNames) {
  const cfDir = getCloudForgeDir(workingDir);
  if (!fs.existsSync(cfDir)) return { completedPhases: [], latestDetectedPhase: null };

  const detectedPhases = new Set();

  // Check artifact files
  for (const [filename, phaseName] of Object.entries(ARTIFACT_PHASE_MAP)) {
    const filePath = path.join(cfDir, filename);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > 0)
        detectedPhases.add(phaseName);
    }
  }

  // Check prd/ directory
  const prdDir = path.join(cfDir, 'prd');
  if (fs.existsSync(prdDir) && fs.statSync(prdDir).isDirectory()) {
    const mdFiles = fs.readdirSync(prdDir).filter((f) => f.endsWith('.md'));
    if (mdFiles.length > 0)
      detectedPhases.add('DISCOVER');
  }

  if (detectedPhases.size === 0)
    return { completedPhases: [], latestDetectedPhase: null };

  // Find the latest detected phase by workflow order
  let latestIndex = -1;
  let latestDetectedPhase = null;
  for (const phase of detectedPhases) {
    const idx = orderedPhaseNames.indexOf(phase);
    if (idx > latestIndex) {
      latestIndex = idx;
      latestDetectedPhase = phase;
    }
  }

  // All phases before the latest are treated as completed (prerequisite inference)
  // The latest itself is NOT completed — it becomes the resume point
  const completedPhases = [];
  for (let i = 0; i < latestIndex; ++i)
    completedPhases.push(orderedPhaseNames[i]);

  return { completedPhases, latestDetectedPhase };
}

function inferResumePhase(completedPhases, latestDetectedPhase, orderedPhaseNames) {
  // If we detected artifacts, re-run the latest phase (don't skip ahead)
  if (latestDetectedPhase)
    return latestDetectedPhase;

  // If completedPhases exist but no latest detected, return next after latest completed
  if (completedPhases.length > 0) {
    let maxIdx = -1;
    for (const phase of completedPhases) {
      const idx = orderedPhaseNames.indexOf(phase);
      if (idx > maxIdx)
        maxIdx = idx;
    }
    const nextIdx = maxIdx + 1;
    if (nextIdx < orderedPhaseNames.length)
      return orderedPhaseNames[nextIdx];
    // All done — wrap to first
    return orderedPhaseNames[0];
  }

  // No phases detected at all — start from the beginning
  return orderedPhaseNames[0];
}

function countPlanSubTasks(content) {
  const subTaskRegex = /^##\s+Sub-task\s+(\d+)/gm;
  let count = 0;
  while (subTaskRegex.exec(content) !== null)
    ++count;
  return count;
}

function recoverStateFromArtifacts(workingDir, orderedPhaseNames, options = {}) {
  const task = inferTaskFromArtifacts(workingDir);
  if (!task) return null;

  const { completedPhases, latestDetectedPhase } = inferCompletedPhases(workingDir, orderedPhaseNames);
  const resumePhase = inferResumePhase(completedPhases, latestDetectedPhase, orderedPhaseNames);

  const wfState = createInitialState(task, {
    initialPhase: resumePhase,
    ...options,
  });

  wfState.completedPhases = completedPhases;

  // Try to recover sub-task info from plan.md
  const planPath = getPlanPath(workingDir);
  if (fs.existsSync(planPath)) {
    try {
      const planContent = fs.readFileSync(planPath, 'utf8');
      const count = countPlanSubTasks(planContent);
      if (count > 0)
        wfState.totalSubTasks = count;
    } catch { /* ignore */ }
  }

  return wfState;
}

function repairState(wfState, orderedPhaseNames) {
  const phaseSet = new Set(orderedPhaseNames);

  // Invalid or missing phase -> DISCOVER
  if (!wfState.phase || !phaseSet.has(wfState.phase))
    wfState.phase = orderedPhaseNames[0] || 'DISCOVER';

  // Iteration must be a non-negative number
  if (typeof wfState.iteration !== 'number' || wfState.iteration < 0 || !isFinite(wfState.iteration))
    wfState.iteration = 0;

  // maxIterations must be a positive number
  if (typeof wfState.maxIterations !== 'number' || wfState.maxIterations <= 0 || !isFinite(wfState.maxIterations))
    wfState.maxIterations = 25;

  // Ensure arrays
  if (!Array.isArray(wfState.history))
    wfState.history = [];
  if (!Array.isArray(wfState.completedPhases))
    wfState.completedPhases = [];

  // Filter invalid phase names from completedPhases
  wfState.completedPhases = wfState.completedPhases.filter((p) => phaseSet.has(p));

  // Ensure totalTokens
  if (!wfState.totalTokens || typeof wfState.totalTokens !== 'object')
    wfState.totalTokens = { input: 0, output: 0 };
  if (typeof wfState.totalTokens.input !== 'number' || !isFinite(wfState.totalTokens.input))
    wfState.totalTokens.input = 0;
  if (typeof wfState.totalTokens.output !== 'number' || !isFinite(wfState.totalTokens.output))
    wfState.totalTokens.output = 0;

  // Validate timestamps
  if (!wfState.startedAt || isNaN(Date.parse(wfState.startedAt)))
    wfState.startedAt = new Date().toISOString();
  if (!wfState.lastActivity || isNaN(Date.parse(wfState.lastActivity)))
    wfState.lastActivity = new Date().toISOString();

  // Ensure numeric fields
  if (typeof wfState.currentSubTask !== 'number' || !isFinite(wfState.currentSubTask))
    wfState.currentSubTask = 0;
  if (typeof wfState.totalSubTasks !== 'number' || !isFinite(wfState.totalSubTasks))
    wfState.totalSubTasks = 0;
  if (typeof wfState.consecutiveRetries !== 'number' || !isFinite(wfState.consecutiveRetries))
    wfState.consecutiveRetries = 0;

  if (!Array.isArray(wfState.lastErrors))
    wfState.lastErrors = [];

  // Clear circuit breaker state on resume — re-running is an explicit "try again"
  wfState.consecutiveRetries = 0;
  wfState.lastErrors = [];

  return wfState;
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
  ARTIFACT_PHASE_MAP,
  hasCloudForgeDir,
  tryLoadState,
  inferTaskFromArtifacts,
  inferCompletedPhases,
  inferResumePhase,
  countPlanSubTasks,
  recoverStateFromArtifacts,
  repairState,
};
