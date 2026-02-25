'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const phases = require('../lib/phases');

describe('phases', () => {
  describe('parseCloudForgeStatus', () => {
    it('parses a well-formed CLOUDFORGE_STATUS block', () => {
      const output = `Some text here

CLOUDFORGE_STATUS:
  phase: DISCOVER
  result: DONE
  tasks_remaining: 5
  summary: Analyzed the codebase structure

More text after`;

      const status = phases.parseCloudForgeStatus(output);
      assert.ok(status);
      assert.equal(status.phase, 'DISCOVER');
      assert.equal(status.result, 'DONE');
      assert.equal(status.tasksRemaining, 5);
      assert.equal(status.summary, 'Analyzed the codebase structure');
    });

    it('handles NEEDS_RETRY result', () => {
      const output = `CLOUDFORGE_STATUS:
  phase: VERIFY
  result: NEEDS_RETRY
  tasks_remaining: 3
  summary: Tests failed - 2 assertion errors

`;
      const status = phases.parseCloudForgeStatus(output);
      assert.equal(status.result, 'NEEDS_RETRY');
    });

    it('handles BLOCKED result', () => {
      const output = `CLOUDFORGE_STATUS:
  phase: IMPLEMENT
  result: BLOCKED
  tasks_remaining: 4
  summary: Missing dependency

`;
      const status = phases.parseCloudForgeStatus(output);
      assert.equal(status.result, 'BLOCKED');
    });

    it('returns null when no CLOUDFORGE_STATUS found', () => {
      assert.equal(phases.parseCloudForgeStatus('just some text'), null);
    });

    it('returns null for empty string', () => {
      assert.equal(phases.parseCloudForgeStatus(''), null);
    });

    it('handles status at end of output without trailing newlines', () => {
      const output = `Done.

CLOUDFORGE_STATUS:
  phase: REVIEW
  result: DONE
  tasks_remaining: 0
  summary: All complete`;

      const status = phases.parseCloudForgeStatus(output);
      assert.ok(status);
      assert.equal(status.phase, 'REVIEW');
      assert.equal(status.result, 'DONE');
      assert.equal(status.tasksRemaining, 0);
    });

    it('normalizes result to uppercase', () => {
      const output = `CLOUDFORGE_STATUS:
  phase: TEST
  result: done
  tasks_remaining: 0
  summary: ok

`;
      const status = phases.parseCloudForgeStatus(output);
      assert.equal(status.result, 'DONE');
    });

    it('defaults result to DONE if missing', () => {
      const output = `CLOUDFORGE_STATUS:
  phase: DISCOVER
  summary: discovered

`;
      const status = phases.parseCloudForgeStatus(output);
      assert.equal(status.result, 'DONE');
    });

    it('returns null tasksRemaining for non-numeric values', () => {
      const output = `CLOUDFORGE_STATUS:
  phase: PLAN
  result: DONE
  tasks_remaining: TBD
  summary: planned

`;
      const status = phases.parseCloudForgeStatus(output);
      assert.equal(status.tasksRemaining, null);
    });
  });

  describe('getPromptForPhase', () => {
    it('generates DISCOVER prompt with task description', () => {
      const prompt = phases.getPromptForPhase('DISCOVER', 'Add auth');
      assert.ok(prompt.includes('DISCOVER'));
      assert.ok(prompt.includes('Add auth'));
      assert.ok(prompt.includes('CLOUDFORGE_STATUS'));
    });

    it('generates REQUIREMENTS prompt', () => {
      const prompt = phases.getPromptForPhase('REQUIREMENTS', 'Add auth');
      assert.ok(prompt.includes('REQUIREMENTS'));
      assert.ok(prompt.includes('user stories'));
    });

    it('generates PRIORITIZE prompt with MoSCoW', () => {
      const prompt = phases.getPromptForPhase('PRIORITIZE', 'Add auth');
      assert.ok(prompt.includes('MoSCoW'));
      assert.ok(prompt.includes('MVP'));
      assert.ok(prompt.includes('KPI'));
    });

    it('generates GATE_SCOPE prompt', () => {
      const prompt = phases.getPromptForPhase('GATE_SCOPE', 'Add auth');
      assert.ok(prompt.includes('GATE_SCOPE'));
      assert.ok(prompt.includes('Gate criteria'));
    });

    it('generates DOMAIN prompt with DDD', () => {
      const prompt = phases.getPromptForPhase('DOMAIN', 'Add auth');
      assert.ok(prompt.includes('DOMAIN'));
      assert.ok(prompt.includes('Bounded context'));
    });

    it('generates DESIGN prompt', () => {
      const prompt = phases.getPromptForPhase('DESIGN', 'Add auth');
      assert.ok(prompt.includes('DESIGN'));
      assert.ok(prompt.includes('Architecture'));
    });

    it('generates BDD prompt', () => {
      const prompt = phases.getPromptForPhase('BDD', 'Add auth');
      assert.ok(prompt.includes('BDD'));
      assert.ok(prompt.includes('Given'));
    });

    it('generates PLAN prompt with working directory', () => {
      const prompt = phases.getPromptForPhase('PLAN', 'Add auth', { workingDir: '/project' });
      assert.ok(prompt.includes('PLAN'));
      assert.ok(prompt.includes('/project'));
      assert.ok(prompt.includes('plan.md'));
    });

    it('generates PROTOTYPE prompt', () => {
      const prompt = phases.getPromptForPhase('PROTOTYPE', 'Add auth');
      assert.ok(prompt.includes('PROTOTYPE'));
      assert.ok(prompt.includes('spike'));
    });

    it('generates GATE_DESIGN prompt', () => {
      const prompt = phases.getPromptForPhase('GATE_DESIGN', 'Add auth');
      assert.ok(prompt.includes('GATE_DESIGN'));
      assert.ok(prompt.includes('Gate criteria'));
    });

    it('generates TEST prompt with sub-task info and ISTQB', () => {
      const prompt = phases.getPromptForPhase('TEST', 'Add auth', { subTaskNumber: 2, totalSubTasks: 5 });
      assert.ok(prompt.includes('TEST'));
      assert.ok(prompt.includes('2'));
      assert.ok(prompt.includes('5'));
      assert.ok(prompt.includes('ISTQB'));
    });

    it('generates IMPLEMENT prompt', () => {
      const prompt = phases.getPromptForPhase('IMPLEMENT', 'Add auth', { subTaskNumber: 1, totalSubTasks: 3 });
      assert.ok(prompt.includes('IMPLEMENT'));
      assert.ok(prompt.includes('DDD'));
    });

    it('generates VERIFY prompt with ISTQB', () => {
      const prompt = phases.getPromptForPhase('VERIFY', 'Add auth', { subTaskNumber: 1, totalSubTasks: 3 });
      assert.ok(prompt.includes('VERIFY'));
      assert.ok(prompt.includes('ISTQB'));
    });

    it('generates REFACTOR prompt with DDD', () => {
      const prompt = phases.getPromptForPhase('REFACTOR', 'Add auth', { subTaskNumber: 1, totalSubTasks: 3 });
      assert.ok(prompt.includes('REFACTOR'));
      assert.ok(prompt.includes('DDD'));
    });

    it('generates INTEGRATE prompt', () => {
      const prompt = phases.getPromptForPhase('INTEGRATE', 'Add auth');
      assert.ok(prompt.includes('INTEGRATE'));
      assert.ok(prompt.includes('Integration testing'));
    });

    it('generates GATE_QUALITY prompt with KPI', () => {
      const prompt = phases.getPromptForPhase('GATE_QUALITY', 'Add auth');
      assert.ok(prompt.includes('GATE_QUALITY'));
      assert.ok(prompt.includes('KPI'));
    });

    it('generates REVIEW prompt', () => {
      const prompt = phases.getPromptForPhase('REVIEW', 'Add auth');
      assert.ok(prompt.includes('REVIEW'));
      assert.ok(prompt.includes('Final'));
    });

    it('generates INNOVATE prompt', () => {
      const prompt = phases.getPromptForPhase('INNOVATE', 'Add auth');
      assert.ok(prompt.includes('INNOVATE'));
      assert.ok(prompt.includes('innovation'));
    });

    it('throws for unknown phase (no template file)', () => {
      assert.throws(() => phases.getPromptForPhase('INVALID', 'task'));
    });
  });

  describe('getNextPhase', () => {
    it('DISCOVER -> REQUIREMENTS on DONE', () => {
      assert.equal(phases.getNextPhase('DISCOVER', { result: 'DONE' }), 'REQUIREMENTS');
    });

    it('DISCOVER retries on NEEDS_RETRY', () => {
      assert.equal(phases.getNextPhase('DISCOVER', { result: 'NEEDS_RETRY' }), 'DISCOVER');
    });

    it('REQUIREMENTS -> PRIORITIZE on DONE', () => {
      assert.equal(phases.getNextPhase('REQUIREMENTS', { result: 'DONE' }), 'PRIORITIZE');
    });

    it('PRIORITIZE -> GATE_SCOPE on DONE', () => {
      assert.equal(phases.getNextPhase('PRIORITIZE', { result: 'DONE' }), 'GATE_SCOPE');
    });

    it('GATE_SCOPE -> DOMAIN on DONE', () => {
      assert.equal(phases.getNextPhase('GATE_SCOPE', { result: 'DONE' }), 'DOMAIN');
    });

    it('GATE_SCOPE -> REQUIREMENTS on NEEDS_RETRY', () => {
      assert.equal(phases.getNextPhase('GATE_SCOPE', { result: 'NEEDS_RETRY' }), 'REQUIREMENTS');
    });

    it('GATE_SCOPE -> DOMAIN when retries exhausted', () => {
      const ctx = { retryCount: 3, maxRetries: 3 };
      assert.equal(phases.getNextPhase('GATE_SCOPE', { result: 'NEEDS_RETRY' }, ctx), 'DOMAIN');
    });

    it('DOMAIN -> DESIGN on DONE', () => {
      assert.equal(phases.getNextPhase('DOMAIN', { result: 'DONE' }), 'DESIGN');
    });

    it('DESIGN -> BDD on DONE', () => {
      assert.equal(phases.getNextPhase('DESIGN', { result: 'DONE' }), 'BDD');
    });

    it('BDD -> PLAN on DONE', () => {
      assert.equal(phases.getNextPhase('BDD', { result: 'DONE' }), 'PLAN');
    });

    it('PLAN -> PROTOTYPE on DONE', () => {
      assert.equal(phases.getNextPhase('PLAN', { result: 'DONE' }), 'PROTOTYPE');
    });

    it('PROTOTYPE -> GATE_DESIGN on DONE', () => {
      assert.equal(phases.getNextPhase('PROTOTYPE', { result: 'DONE' }), 'GATE_DESIGN');
    });

    it('GATE_DESIGN -> TEST on DONE', () => {
      assert.equal(phases.getNextPhase('GATE_DESIGN', { result: 'DONE' }), 'TEST');
    });

    it('GATE_DESIGN -> DESIGN on NEEDS_RETRY', () => {
      assert.equal(phases.getNextPhase('GATE_DESIGN', { result: 'NEEDS_RETRY' }), 'DESIGN');
    });

    it('GATE_DESIGN -> TEST when retries exhausted', () => {
      const ctx = { retryCount: 3, maxRetries: 3 };
      assert.equal(phases.getNextPhase('GATE_DESIGN', { result: 'NEEDS_RETRY' }, ctx), 'TEST');
    });

    it('TEST -> IMPLEMENT on DONE', () => {
      assert.equal(phases.getNextPhase('TEST', { result: 'DONE' }), 'IMPLEMENT');
    });

    it('IMPLEMENT -> VERIFY on DONE', () => {
      assert.equal(phases.getNextPhase('IMPLEMENT', { result: 'DONE' }), 'VERIFY');
    });

    it('VERIFY -> REFACTOR on DONE', () => {
      assert.equal(phases.getNextPhase('VERIFY', { result: 'DONE' }), 'REFACTOR');
    });

    it('VERIFY -> IMPLEMENT on NEEDS_RETRY with retries left', () => {
      const ctx = { retryCount: 1, maxRetries: 3 };
      assert.equal(phases.getNextPhase('VERIFY', { result: 'NEEDS_RETRY' }, ctx), 'IMPLEMENT');
    });

    it('VERIFY -> REFACTOR when retries exhausted', () => {
      const ctx = { retryCount: 3, maxRetries: 3 };
      assert.equal(phases.getNextPhase('VERIFY', { result: 'NEEDS_RETRY' }, ctx), 'REFACTOR');
    });

    it('REFACTOR -> TEST for next sub-task when more remain', () => {
      const ctx = { subTaskNumber: 2, totalSubTasks: 5 };
      assert.equal(phases.getNextPhase('REFACTOR', { result: 'DONE' }, ctx), 'TEST');
    });

    it('REFACTOR -> INTEGRATE when all sub-tasks done', () => {
      const ctx = { subTaskNumber: 5, totalSubTasks: 5 };
      assert.equal(phases.getNextPhase('REFACTOR', { result: 'DONE' }, ctx), 'INTEGRATE');
    });

    it('INTEGRATE -> GATE_QUALITY on DONE', () => {
      assert.equal(phases.getNextPhase('INTEGRATE', { result: 'DONE' }), 'GATE_QUALITY');
    });

    it('GATE_QUALITY -> REVIEW on DONE', () => {
      assert.equal(phases.getNextPhase('GATE_QUALITY', { result: 'DONE' }), 'REVIEW');
    });

    it('GATE_QUALITY -> INTEGRATE on NEEDS_RETRY', () => {
      assert.equal(phases.getNextPhase('GATE_QUALITY', { result: 'NEEDS_RETRY' }), 'INTEGRATE');
    });

    it('GATE_QUALITY -> REVIEW when retries exhausted', () => {
      const ctx = { retryCount: 3, maxRetries: 3 };
      assert.equal(phases.getNextPhase('GATE_QUALITY', { result: 'NEEDS_RETRY' }, ctx), 'REVIEW');
    });

    it('REVIEW -> INNOVATE on DONE', () => {
      assert.equal(phases.getNextPhase('REVIEW', { result: 'DONE' }), 'INNOVATE');
    });

    it('INNOVATE -> null (done) on DONE', () => {
      assert.equal(phases.getNextPhase('INNOVATE', { result: 'DONE' }), null);
    });

    it('INNOVATE -> DISCOVER on NEEDS_RETRY (next innovation round)', () => {
      assert.equal(phases.getNextPhase('INNOVATE', { result: 'NEEDS_RETRY' }), 'DISCOVER');
    });

    it('handles null status gracefully', () => {
      assert.equal(phases.getNextPhase('DISCOVER', null), 'REQUIREMENTS');
    });

    it('returns null for unknown phase', () => {
      assert.equal(phases.getNextPhase('NOSUCH', { result: 'DONE' }), null);
    });
  });

  describe('parsePlanFile', () => {
    it('counts sub-tasks from plan markdown', () => {
      const plan = `# Implementation Plan

## Sub-task 1: Setup auth module
- **Implement**: Create auth service

## Sub-task 2: Add JWT generation
- **Implement**: JWT helper

## Sub-task 3: Add middleware
- **Implement**: Auth middleware
`;
      assert.equal(phases.parsePlanFile(plan), 3);
    });

    it('returns 0 for empty plan', () => {
      assert.equal(phases.parsePlanFile(''), 0);
    });

    it('returns 0 for plan without sub-tasks', () => {
      assert.equal(phases.parsePlanFile('# Plan\nSome text'), 0);
    });

    it('handles single sub-task', () => {
      const plan = `## Sub-task 1: Only task\n- stuff`;
      assert.equal(phases.parsePlanFile(plan), 1);
    });
  });

  describe('isTaskLoopPhase', () => {
    it('returns true for task loop phases', () => {
      assert.ok(phases.isTaskLoopPhase('TEST'));
      assert.ok(phases.isTaskLoopPhase('IMPLEMENT'));
      assert.ok(phases.isTaskLoopPhase('VERIFY'));
      assert.ok(phases.isTaskLoopPhase('REFACTOR'));
    });

    it('returns false for non-task-loop phases', () => {
      assert.ok(!phases.isTaskLoopPhase('DISCOVER'));
      assert.ok(!phases.isTaskLoopPhase('REQUIREMENTS'));
      assert.ok(!phases.isTaskLoopPhase('DESIGN'));
      assert.ok(!phases.isTaskLoopPhase('PLAN'));
      assert.ok(!phases.isTaskLoopPhase('REVIEW'));
      assert.ok(!phases.isTaskLoopPhase('INNOVATE'));
      assert.ok(!phases.isTaskLoopPhase('INTEGRATE'));
      assert.ok(!phases.isTaskLoopPhase('GATE_SCOPE'));
    });
  });

  describe('getInitialPhaseSequence', () => {
    it('returns the expected phase order', () => {
      const seq = phases.getInitialPhaseSequence();
      assert.equal(seq[0], 'DISCOVER');
      assert.equal(seq[1], 'REQUIREMENTS');
      assert.equal(seq[2], 'PRIORITIZE');
      assert.equal(seq[3], 'GATE_SCOPE');
      assert.equal(seq[4], 'DOMAIN');
      assert.equal(seq[5], 'DESIGN');
      assert.equal(seq[6], 'BDD');
      assert.equal(seq[7], 'PLAN');
      assert.equal(seq[8], 'PROTOTYPE');
      assert.equal(seq[9], 'GATE_DESIGN');
      assert.ok(seq[10].includes('TASK_LOOP'));
      assert.ok(seq[10].includes('TEST'));
      assert.ok(seq[10].includes('REFACTOR'));
    });

    it('ends with INTEGRATE, GATE_QUALITY, REVIEW, INNOVATE after task loop', () => {
      const seq = phases.getInitialPhaseSequence();
      const last4 = seq.slice(-4);
      assert.equal(last4[0], 'INTEGRATE');
      assert.equal(last4[1], 'GATE_QUALITY');
      assert.equal(last4[2], 'REVIEW');
      assert.equal(last4[3], 'INNOVATE');
    });
  });

  describe('getFirstPhase', () => {
    it('returns DISCOVER as the first phase', () => {
      assert.equal(phases.getFirstPhase(), 'DISCOVER');
    });
  });

  describe('getOrderedPhaseNames', () => {
    it('returns all phase names in workflow order', () => {
      const names = phases.getOrderedPhaseNames();
      assert.ok(Array.isArray(names));
      assert.ok(names.length >= 18, `expected at least 18 phases, got ${names.length}`);
      assert.equal(names[0], 'DISCOVER');
      assert.ok(names.includes('INNOVATE'));
      assert.ok(names.indexOf('DISCOVER') < names.indexOf('REQUIREMENTS'));
      assert.ok(names.indexOf('REQUIREMENTS') < names.indexOf('PRIORITIZE'));
      assert.ok(names.indexOf('TEST') < names.indexOf('IMPLEMENT'));
    });
  });

  describe('workflow.dot parsing', () => {
    it('parseWorkflowFile extracts phases from DOT content', () => {
      const dot = `
ALPHA -> BETA  [done]
ALPHA -> ALPHA [retry]
*BETA -> GAMMA [done]
*BETA -> BETA  [retry]
GAMMA -> END   [done]
`;
      const wf = phases.parseWorkflowFile(dot);
      assert.equal(wf.phases.length, 3);
      assert.equal(wf.phases[0].name, 'ALPHA');
      assert.equal(wf.phases[1].name, 'BETA');
      assert.equal(wf.phases[2].name, 'GAMMA');
    });

    it('marks starred phases as taskLoop', () => {
      const dot = `
ALPHA -> BETA [done]
*BETA -> GAMMA [done]
GAMMA -> END [done]
`;
      const wf = phases.parseWorkflowFile(dot);
      assert.equal(wf.phases[0].taskLoop, false);
      assert.equal(wf.phases[1].taskLoop, true);
      assert.equal(wf.phases[2].taskLoop, false);
    });

    it('parses all transition conditions', () => {
      const dot = `
*V -> R [done]
*V -> I [retry]
*V -> R [retry_exhausted]
`;
      const wf = phases.parseWorkflowFile(dot);
      const v = wf.phases[0];
      assert.equal(v.transitions.done, 'R');
      assert.equal(v.transitions.retry, 'I');
      assert.equal(v.transitions.retry_exhausted, 'R');
    });

    it('resolves END target as null', () => {
      const dot = `X -> END [done]\n`;
      const wf = phases.parseWorkflowFile(dot);
      assert.equal(wf.phases[0].transitions.done, null);
    });

    it('ignores comments and blank lines', () => {
      const dot = `
# This is a comment
A -> B [done]

# Another comment
B -> END [done]
`;
      const wf = phases.parseWorkflowFile(dot);
      assert.equal(wf.phases.length, 2);
    });

    it('ignores inline comments', () => {
      const dot = `A -> B [done]  # go to B\n`;
      const wf = phases.parseWorkflowFile(dot);
      assert.equal(wf.phases[0].transitions.done, 'B');
    });

    it('loadWorkflow returns all 18 phases from workflow.dot', () => {
      phases.clearWorkflowCache();
      const wf = phases.loadWorkflow();
      assert.equal(wf.phases.length, 18);
      assert.equal(wf.phases[0].name, 'DISCOVER');
      assert.equal(wf.phases[17].name, 'INNOVATE');
    });

    it('WORKFLOW_PATH points to workflow.dot', () => {
      assert.ok(phases.WORKFLOW_PATH.endsWith('workflow.dot'));
    });

    it('getPhaseConfig returns config for known phase', () => {
      const cfg = phases.getPhaseConfig('VERIFY');
      assert.ok(cfg);
      assert.equal(cfg.name, 'VERIFY');
      assert.equal(cfg.taskLoop, true);
      assert.ok(cfg.transitions.done);
    });

    it('getPhaseConfig returns null for unknown phase', () => {
      assert.equal(phases.getPhaseConfig('NOSUCH'), null);
    });

    it('getPhaseNames returns all phase names from workflow', () => {
      const names = phases.getPhaseNames();
      assert.ok(names.DISCOVER);
      assert.ok(names.REVIEW);
      assert.ok(names.VERIFY);
      assert.ok(names.INNOVATE);
      assert.ok(names.GATE_SCOPE);
    });

    it('clearWorkflowCache forces re-parse', () => {
      phases.loadWorkflow();
      phases.clearWorkflowCache();
      const wf = phases.loadWorkflow();
      assert.equal(wf.phases.length, 18);
    });
  });

  describe('template system', () => {
    it('all phase template files exist', () => {
      const expected = [
        'discover', 'requirements', 'prioritize', 'gate_scope',
        'domain', 'design', 'bdd', 'plan', 'prototype', 'gate_design',
        'test', 'implement', 'verify', 'refactor',
        'integrate', 'gate_quality', 'review', 'innovate',
        'status_tag',
      ];
      for (const name of expected) {
        const filePath = path.join(phases.PROMPTS_DIR, `${name}.txt`);
        assert.ok(fs.existsSync(filePath), `${name}.txt should exist in prompts/`);
      }
    });

    it('fillTemplate replaces {task} placeholder', () => {
      const result = phases.fillTemplate('TASK: {task}', { task: 'Build a widget' });
      assert.equal(result, 'TASK: Build a widget');
    });

    it('fillTemplate replaces multiple placeholders', () => {
      const result = phases.fillTemplate('{a} and {b}', { a: 'X', b: 'Y' });
      assert.equal(result, 'X and Y');
    });

    it('fillTemplate replaces repeated placeholders', () => {
      const result = phases.fillTemplate('{x} then {x}', { x: 'Z' });
      assert.equal(result, 'Z then Z');
    });

    it('fillTemplate skips null values', () => {
      const result = phases.fillTemplate('{a} {b}', { a: 'yes', b: null });
      assert.equal(result, 'yes {b}');
    });

    it('fillTemplate resolves {status_tag}', () => {
      const result = phases.fillTemplate('before {status_tag} after', {});
      assert.ok(result.includes('CLOUDFORGE_STATUS'));
      assert.ok(!result.includes('{status_tag}'));
    });

    it('loadTemplate caches after first read', () => {
      phases.clearTemplateCache();
      const first = phases.loadTemplate('discover');
      const second = phases.loadTemplate('discover');
      assert.equal(first, second);
    });

    it('clearTemplateCache forces re-read', () => {
      phases.loadTemplate('discover');
      phases.clearTemplateCache();
      const result = phases.loadTemplate('discover');
      assert.ok(result.includes('DISCOVER'));
    });
  });
});
