'use strict';

const fs = require('fs');
const path = require('path');

const CLOUDFORGE_STATUS_REGEX = /CLOUDFORGE_STATUS:\s*\n([\s\S]*?)(?:\n\s*\n|$)/;
const STATUS_FIELD_REGEX = /^\s*(\w+)\s*:\s*(.+)$/gm;

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const WORKFLOW_PATH = path.join(PROMPTS_DIR, 'workflow.dot');

// Cache loaded templates to avoid re-reading on every invocation
const templateCache = {};

// Cached workflow definition
let workflowCache = null;

// ── Workflow parser ──

const TRANSITION_REGEX = /^(\*?)(\w+)\s*->\s*(\w+)\s*\[(\w+)\]$/;

function parseWorkflowFile(content) {
  const phases = new Map(); // name -> { name, taskLoop, transitions: {} }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const m = line.match(TRANSITION_REGEX);
    if (!m) continue;

    const [, star, from, to, condition] = m;
    const taskLoop = star === '*';
    const target = to === 'END' ? null : to;

    if (!phases.has(from))
      phases.set(from, { name: from, taskLoop: false, transitions: {} });

    const phase = phases.get(from);
    if (taskLoop) phase.taskLoop = true;
    phase.transitions[condition] = target;
  }

  // Preserve insertion order as the phase sequence
  return { phases: [...phases.values()] };
}

function loadWorkflow() {
  if (workflowCache) return workflowCache;
  const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  workflowCache = parseWorkflowFile(raw);
  return workflowCache;
}

function clearWorkflowCache() {
  workflowCache = null;
}

function getPhaseConfig(phaseName) {
  const wf = loadWorkflow();
  return wf.phases.find((p) => p.name === phaseName) || null;
}

// ── Template system ──

function loadTemplate(name) {
  if (templateCache[name]) return templateCache[name];
  const filePath = path.join(PROMPTS_DIR, `${name}.txt`);
  const content = fs.readFileSync(filePath, 'utf8');
  templateCache[name] = content;
  return content;
}

function fillTemplate(template, vars) {
  let result = template;
  if (result.includes('{status_tag}'))
    result = result.replace(/\{status_tag\}/g, loadTemplate('status_tag'));

  for (const [key, value] of Object.entries(vars)) {
    if (value != null)
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}

function getPromptForPhase(phaseName, task, context = {}) {
  const { subTaskNumber, totalSubTasks, workingDir } = context;
  const templateName = phaseName.toLowerCase();

  const vars = {
    task,
    subTaskNumber,
    totalSubTasks,
    workingDir: workingDir || process.cwd(),
  };

  const template = loadTemplate(templateName);
  return fillTemplate(template, vars);
}

function clearTemplateCache() {
  for (const key of Object.keys(templateCache))
    delete templateCache[key];
}

// ── Status parsing ──

function parseCloudForgeStatus(output) {
  const match = output.match(CLOUDFORGE_STATUS_REGEX);
  if (!match) return null;

  const block = match[1];
  const fields = {};
  let m;
  while ((m = STATUS_FIELD_REGEX.exec(block)) !== null)
    fields[m[1].toLowerCase()] = m[2].trim();

  STATUS_FIELD_REGEX.lastIndex = 0;

  return {
    phase: fields.phase || null,
    result: (fields.result || 'DONE').toUpperCase(),
    tasksRemaining: parseTasksRemaining(fields.tasks_remaining || fields.tasksremaining),
    summary: fields.summary || '',
  };
}

function parseTasksRemaining(val) {
  if (val == null) return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

// ── Phase transitions (data-driven from workflow.dot) ──

function getNextPhase(currentPhase, status, context = {}) {
  const { subTaskNumber, totalSubTasks, retryCount, maxRetries } = context;
  const result = status?.result || 'DONE';
  const config = getPhaseConfig(currentPhase);

  if (!config) return null;

  const t = config.transitions;

  if (result === 'DONE' || result === 'BLOCKED') {
    if (t.done_next_subtask && subTaskNumber < totalSubTasks)
      return t.done_next_subtask;
    return t.done != null ? t.done : null;
  }

  if (result === 'NEEDS_RETRY') {
    if (t.retry_exhausted && retryCount >= maxRetries)
      return t.retry_exhausted;

    // Phases with done_next_subtask treat NEEDS_RETRY as done for sub-task advancement
    if (t.done_next_subtask) {
      if (subTaskNumber < totalSubTasks)
        return t.done_next_subtask;
      return t.done != null ? t.done : null;
    }

    return t.retry != null ? t.retry : null;
  }

  return t.retry != null ? t.retry : null;
}

// ── Sequence helpers ──

function getInitialPhaseSequence() {
  const wf = loadWorkflow();
  const result = [];
  let inTaskLoop = false;
  const taskLoopPhases = [];

  for (const phase of wf.phases) {
    if (phase.taskLoop) {
      if (!inTaskLoop) inTaskLoop = true;
      taskLoopPhases.push(phase.name);
    } else {
      if (inTaskLoop) {
        result.push(`TASK_LOOP(${taskLoopPhases.join(' -> ')})`);
        inTaskLoop = false;
        taskLoopPhases.length = 0;
      }
      result.push(phase.name);
    }
  }

  if (inTaskLoop)
    result.push(`TASK_LOOP(${taskLoopPhases.join(' -> ')})`);

  return result;
}

function isTaskLoopPhase(phase) {
  const config = getPhaseConfig(phase);
  return config ? config.taskLoop : false;
}

function parsePlanFile(content) {
  const subTaskRegex = /^##\s+Sub-task\s+(\d+)/gm;
  const tasks = [];
  let m;
  while ((m = subTaskRegex.exec(content)) !== null)
    tasks.push(parseInt(m[1], 10));
  return tasks.length > 0 ? tasks.length : 0;
}

function getPhaseNames() {
  const wf = loadWorkflow();
  const names = {};
  for (const phase of wf.phases)
    names[phase.name] = phase.name;
  return names;
}

function getFirstPhase() {
  const wf = loadWorkflow();
  return wf.phases[0]?.name || 'DISCOVER';
}

// Computed PHASE_NAMES for backward compatibility
const PHASE_NAMES = (() => {
  try {
    return getPhaseNames();
  } catch {
    return {};
  }
})();

module.exports = {
  PHASE_NAMES,
  PROMPTS_DIR,
  WORKFLOW_PATH,
  getPromptForPhase,
  fillTemplate,
  loadTemplate,
  clearTemplateCache,
  loadWorkflow,
  clearWorkflowCache,
  parseWorkflowFile,
  getPhaseConfig,
  getPhaseNames,
  getFirstPhase,
  parseCloudForgeStatus,
  getNextPhase,
  getInitialPhaseSequence,
  isTaskLoopPhase,
  parsePlanFile,
  CLOUDFORGE_STATUS_REGEX,
  STATUS_FIELD_REGEX,
};
