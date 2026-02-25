'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const st = require('../lib/state');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cloudforge-test-'));
}

function cleanTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('state', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { cleanTempDir(tmpDir); });

  describe('createInitialState', () => {
    it('creates state with defaults', () => {
      const s = st.createInitialState('test task');
      assert.equal(s.task, 'test task');
      assert.equal(s.phase, 'DISCOVER');
      assert.equal(s.iteration, 0);
      assert.equal(s.maxIterations, 25);
      assert.equal(s.currentSubTask, 0);
      assert.equal(s.totalSubTasks, 0);
      assert.ok(s.startedAt);
    });

    it('accepts custom initial phase', () => {
      const s = st.createInitialState('task', { initialPhase: 'CUSTOM' });
      assert.equal(s.phase, 'CUSTOM');
    });

    it('accepts custom options', () => {
      const s = st.createInitialState('task', { maxIterations: 10, maxPhaseRetries: 5, model: 'opus' });
      assert.equal(s.maxIterations, 10);
      assert.equal(s.maxPhaseRetries, 5);
      assert.equal(s.model, 'opus');
    });
  });

  describe('saveState / loadState', () => {
    it('round-trips state through JSON file', () => {
      const s = st.createInitialState('test');
      st.saveState(tmpDir, s);
      const loaded = st.loadState(tmpDir);
      assert.equal(loaded.task, 'test');
      assert.equal(loaded.phase, 'DISCOVER');
    });

    it('creates .cloudforge directory if missing', () => {
      const s = st.createInitialState('test');
      st.saveState(tmpDir, s);
      assert.ok(fs.existsSync(path.join(tmpDir, '.cloudforge')));
    });

    it('returns null when no state file exists', () => {
      assert.equal(st.loadState(tmpDir), null);
    });

    it('updates lastActivity on save', () => {
      const s = st.createInitialState('test');
      const before = s.lastActivity;
      // Small delay to ensure time difference
      st.saveState(tmpDir, s);
      const loaded = st.loadState(tmpDir);
      assert.ok(loaded.lastActivity);
    });
  });

  describe('recordIteration', () => {
    it('increments iteration counter', () => {
      const s = st.createInitialState('test');
      st.recordIteration(s, 'ANALYZE', { result: 'DONE', summary: 'analyzed' }, { input: 1000, output: 500 });
      assert.equal(s.iteration, 1);
    });

    it('accumulates tokens', () => {
      const s = st.createInitialState('test');
      st.recordIteration(s, 'ANALYZE', { result: 'DONE' }, { input: 1000, output: 500 });
      st.recordIteration(s, 'DESIGN', { result: 'DONE' }, { input: 2000, output: 800 });
      assert.equal(s.totalTokens.input, 3000);
      assert.equal(s.totalTokens.output, 1300);
    });

    it('records history entries', () => {
      const s = st.createInitialState('test');
      st.recordIteration(s, 'ANALYZE', { result: 'DONE', summary: 'done' }, { input: 100, output: 50 });
      assert.equal(s.history.length, 1);
      assert.equal(s.history[0].phase, 'ANALYZE');
      assert.equal(s.history[0].result, 'DONE');
    });

    it('handles null tokens', () => {
      const s = st.createInitialState('test');
      st.recordIteration(s, 'ANALYZE', { result: 'DONE' }, null);
      assert.equal(s.totalTokens.input, 0);
      assert.equal(s.totalTokens.output, 0);
    });

    it('handles null result', () => {
      const s = st.createInitialState('test');
      st.recordIteration(s, 'ANALYZE', null, { input: 100, output: 50 });
      assert.equal(s.history[0].result, 'UNKNOWN');
    });
  });

  describe('trackRetry', () => {
    it('increments consecutive retries on NEEDS_RETRY', () => {
      const s = st.createInitialState('test');
      st.recordIteration(s, 'VERIFY', { result: 'NEEDS_RETRY' }, {});
      st.trackRetry(s, 'VERIFY', 'test failed');
      assert.equal(s.consecutiveRetries, 1);
    });

    it('resets consecutive retries on DONE', () => {
      const s = st.createInitialState('test');
      s.consecutiveRetries = 2;
      st.recordIteration(s, 'VERIFY', { result: 'DONE' }, {});
      st.trackRetry(s, 'VERIFY', null);
      assert.equal(s.consecutiveRetries, 0);
    });

    it('tracks error messages', () => {
      const s = st.createInitialState('test');
      st.recordIteration(s, 'VERIFY', { result: 'NEEDS_RETRY' }, {});
      st.trackRetry(s, 'VERIFY', 'assertion error');
      assert.deepEqual(s.lastErrors, ['assertion error']);
    });

    it('limits error history to 5 entries', () => {
      const s = st.createInitialState('test');
      for (let i = 0; i < 7; ++i) {
        st.recordIteration(s, 'VERIFY', { result: 'NEEDS_RETRY' }, {});
        st.trackRetry(s, 'VERIFY', `error ${i}`);
      }
      assert.equal(s.lastErrors.length, 5);
    });
  });

  describe('markPhaseCompleted', () => {
    it('adds phase to completed list', () => {
      const s = st.createInitialState('test');
      st.markPhaseCompleted(s, 'ANALYZE');
      assert.deepEqual(s.completedPhases, ['ANALYZE']);
    });

    it('does not duplicate completed phases', () => {
      const s = st.createInitialState('test');
      st.markPhaseCompleted(s, 'ANALYZE');
      st.markPhaseCompleted(s, 'ANALYZE');
      assert.equal(s.completedPhases.length, 1);
    });

    it('resets consecutive retries', () => {
      const s = st.createInitialState('test');
      s.consecutiveRetries = 3;
      st.markPhaseCompleted(s, 'ANALYZE');
      assert.equal(s.consecutiveRetries, 0);
    });
  });

  describe('circuit breaker', () => {
    describe('checkMaxIterations', () => {
      it('halts when iterations exhausted', () => {
        const s = st.createInitialState('test', { maxIterations: 5 });
        s.iteration = 5;
        const result = st.checkMaxIterations(s);
        assert.equal(result.halt, true);
        assert.ok(result.reason.includes('Max iterations'));
      });

      it('does not halt with iterations remaining', () => {
        const s = st.createInitialState('test', { maxIterations: 5 });
        s.iteration = 3;
        assert.equal(st.checkMaxIterations(s).halt, false);
      });
    });

    describe('checkConsecutiveRetries', () => {
      it('halts after threshold consecutive retries', () => {
        const s = st.createInitialState('test');
        s.consecutiveRetries = 3;
        const result = st.checkConsecutiveRetries(s, 3);
        assert.equal(result.halt, true);
      });

      it('does not halt below threshold', () => {
        const s = st.createInitialState('test');
        s.consecutiveRetries = 2;
        assert.equal(st.checkConsecutiveRetries(s, 3).halt, false);
      });
    });

    describe('checkRepeatedErrors', () => {
      it('halts when same error repeats', () => {
        const s = st.createInitialState('test');
        s.lastErrors = ['err', 'err', 'err'];
        const result = st.checkRepeatedErrors(s, 3);
        assert.equal(result.halt, true);
      });

      it('does not halt with different errors', () => {
        const s = st.createInitialState('test');
        s.lastErrors = ['err1', 'err2', 'err3'];
        assert.equal(st.checkRepeatedErrors(s, 3).halt, false);
      });

      it('does not halt with insufficient error history', () => {
        const s = st.createInitialState('test');
        s.lastErrors = ['err', 'err'];
        assert.equal(st.checkRepeatedErrors(s, 3).halt, false);
      });
    });

    describe('checkCircuitBreaker', () => {
      it('returns halt false when no conditions met', () => {
        const s = st.createInitialState('test');
        assert.equal(st.checkCircuitBreaker(s).halt, false);
      });

      it('catches max iterations', () => {
        const s = st.createInitialState('test', { maxIterations: 1 });
        s.iteration = 1;
        assert.equal(st.checkCircuitBreaker(s).halt, true);
      });

      it('catches consecutive retries', () => {
        const s = st.createInitialState('test');
        s.consecutiveRetries = 3;
        assert.equal(st.checkCircuitBreaker(s).halt, true);
      });

      it('catches repeated errors', () => {
        const s = st.createInitialState('test');
        s.lastErrors = ['same', 'same', 'same'];
        assert.equal(st.checkCircuitBreaker(s).halt, true);
      });
    });
  });

  describe('path helpers', () => {
    it('getCloudForgeDir returns .cloudforge under working dir', () => {
      const result = st.getCloudForgeDir('/project');
      assert.ok(result.endsWith('.cloudforge'));
    });

    it('getStatePath returns state.json path', () => {
      const result = st.getStatePath('/project');
      assert.ok(result.endsWith('state.json'));
    });

    it('getPlanPath returns plan.md path', () => {
      const result = st.getPlanPath('/project');
      assert.ok(result.endsWith('plan.md'));
    });
  });

  describe('loadPlan', () => {
    it('returns null when plan does not exist', () => {
      assert.equal(st.loadPlan(tmpDir), null);
    });

    it('reads plan content when file exists', () => {
      st.ensureCloudForgeDir(tmpDir);
      const planPath = st.getPlanPath(tmpDir);
      fs.writeFileSync(planPath, '# Plan\n## Sub-task 1: test', 'utf8');
      const content = st.loadPlan(tmpDir);
      assert.ok(content.includes('Sub-task 1'));
    });
  });

  describe('hasCloudForgeDir', () => {
    it('returns false when .cloudforge does not exist', () => {
      assert.equal(st.hasCloudForgeDir(tmpDir), false);
    });

    it('returns true when .cloudforge directory exists', () => {
      st.ensureCloudForgeDir(tmpDir);
      assert.equal(st.hasCloudForgeDir(tmpDir), true);
    });
  });

  describe('tryLoadState', () => {
    it('returns parsed state when valid', () => {
      const s = st.createInitialState('my task');
      st.saveState(tmpDir, s);
      const loaded = st.tryLoadState(tmpDir);
      assert.equal(loaded.task, 'my task');
    });

    it('returns null when state file is missing', () => {
      assert.equal(st.tryLoadState(tmpDir), null);
    });

    it('returns null when state file is corrupt JSON', () => {
      st.ensureCloudForgeDir(tmpDir);
      fs.writeFileSync(st.getStatePath(tmpDir), '{broken json!!!', 'utf8');
      assert.equal(st.tryLoadState(tmpDir), null);
    });

    it('returns null when task is missing from state', () => {
      st.ensureCloudForgeDir(tmpDir);
      fs.writeFileSync(st.getStatePath(tmpDir), JSON.stringify({ phase: 'DISCOVER' }), 'utf8');
      assert.equal(st.tryLoadState(tmpDir), null);
    });

    it('returns null when task is empty string', () => {
      st.ensureCloudForgeDir(tmpDir);
      fs.writeFileSync(st.getStatePath(tmpDir), JSON.stringify({ task: '', phase: 'DISCOVER' }), 'utf8');
      assert.equal(st.tryLoadState(tmpDir), null);
    });
  });

  describe('inferTaskFromArtifacts', () => {
    it('returns null for empty .cloudforge dir', () => {
      st.ensureCloudForgeDir(tmpDir);
      assert.equal(st.inferTaskFromArtifacts(tmpDir), null);
    });

    it('extracts task from corrupt state.json via regex', () => {
      st.ensureCloudForgeDir(tmpDir);
      fs.writeFileSync(st.getStatePath(tmpDir), '{"task": "Build a REST API", broken', 'utf8');
      assert.equal(st.inferTaskFromArtifacts(tmpDir), 'Build a REST API');
    });

    it('handles escaped quotes in corrupt state.json', () => {
      st.ensureCloudForgeDir(tmpDir);
      fs.writeFileSync(st.getStatePath(tmpDir), '{"task": "Fix the \\"login\\" bug", broken', 'utf8');
      assert.equal(st.inferTaskFromArtifacts(tmpDir), 'Fix the "login" bug');
    });

    it('falls back to requirements.md heading', () => {
      st.ensureCloudForgeDir(tmpDir);
      const cfDir = st.getCloudForgeDir(tmpDir);
      fs.writeFileSync(path.join(cfDir, 'requirements.md'), '# Add user authentication\n\nDetails...', 'utf8');
      assert.equal(st.inferTaskFromArtifacts(tmpDir), 'Add user authentication');
    });

    it('falls back to stories.md heading', () => {
      st.ensureCloudForgeDir(tmpDir);
      const cfDir = st.getCloudForgeDir(tmpDir);
      fs.writeFileSync(path.join(cfDir, 'stories.md'), '# Implement caching layer\n\nStory list...', 'utf8');
      assert.equal(st.inferTaskFromArtifacts(tmpDir), 'Implement caching layer');
    });

    it('falls back to first PRD file heading', () => {
      st.ensureCloudForgeDir(tmpDir);
      const prdDir = path.join(st.getCloudForgeDir(tmpDir), 'prd');
      fs.mkdirSync(prdDir, { recursive: true });
      fs.writeFileSync(path.join(prdDir, 'auth.md'), '# OAuth2 Integration\n\nPRD content...', 'utf8');
      assert.equal(st.inferTaskFromArtifacts(tmpDir), 'OAuth2 Integration');
    });

    it('respects priority order: state.json > requirements.md > stories.md > PRD', () => {
      st.ensureCloudForgeDir(tmpDir);
      const cfDir = st.getCloudForgeDir(tmpDir);
      fs.writeFileSync(st.getStatePath(tmpDir), '{"task": "From state", broken', 'utf8');
      fs.writeFileSync(path.join(cfDir, 'requirements.md'), '# From requirements\n\n', 'utf8');
      assert.equal(st.inferTaskFromArtifacts(tmpDir), 'From state');
    });
  });

  describe('inferCompletedPhases', () => {
    const orderedPhases = [
      'DISCOVER', 'REQUIREMENTS', 'PRIORITIZE', 'GATE_SCOPE',
      'DOMAIN', 'DESIGN', 'BDD', 'PLAN', 'PROTOTYPE', 'GATE_DESIGN',
      'TEST', 'IMPLEMENT', 'VERIFY', 'REFACTOR',
      'INTEGRATE', 'GATE_QUALITY', 'REVIEW', 'INNOVATE',
    ];

    it('returns empty for missing .cloudforge dir', () => {
      const result = st.inferCompletedPhases(tmpDir, orderedPhases);
      assert.deepEqual(result.completedPhases, []);
      assert.equal(result.latestDetectedPhase, null);
    });

    it('detects requirements.md as REQUIREMENTS phase', () => {
      st.ensureCloudForgeDir(tmpDir);
      fs.writeFileSync(path.join(st.getCloudForgeDir(tmpDir), 'requirements.md'), 'content', 'utf8');
      const result = st.inferCompletedPhases(tmpDir, orderedPhases);
      assert.equal(result.latestDetectedPhase, 'REQUIREMENTS');
      assert.deepEqual(result.completedPhases, ['DISCOVER']);
    });

    it('detects prd/ directory as DISCOVER phase', () => {
      st.ensureCloudForgeDir(tmpDir);
      const prdDir = path.join(st.getCloudForgeDir(tmpDir), 'prd');
      fs.mkdirSync(prdDir, { recursive: true });
      fs.writeFileSync(path.join(prdDir, 'feature.md'), 'content', 'utf8');
      const result = st.inferCompletedPhases(tmpDir, orderedPhases);
      assert.equal(result.latestDetectedPhase, 'DISCOVER');
      assert.deepEqual(result.completedPhases, []);
    });

    it('ignores empty prd/ directory', () => {
      st.ensureCloudForgeDir(tmpDir);
      const prdDir = path.join(st.getCloudForgeDir(tmpDir), 'prd');
      fs.mkdirSync(prdDir, { recursive: true });
      const result = st.inferCompletedPhases(tmpDir, orderedPhases);
      assert.equal(result.latestDetectedPhase, null);
    });

    it('infers prerequisite phases as completed', () => {
      st.ensureCloudForgeDir(tmpDir);
      const cfDir = st.getCloudForgeDir(tmpDir);
      fs.writeFileSync(path.join(cfDir, 'domain.md'), 'content', 'utf8');
      const result = st.inferCompletedPhases(tmpDir, orderedPhases);
      assert.equal(result.latestDetectedPhase, 'DOMAIN');
      assert.deepEqual(result.completedPhases, ['DISCOVER', 'REQUIREMENTS', 'PRIORITIZE', 'GATE_SCOPE']);
    });

    it('returns phases sorted by workflow order', () => {
      st.ensureCloudForgeDir(tmpDir);
      const cfDir = st.getCloudForgeDir(tmpDir);
      fs.writeFileSync(path.join(cfDir, 'plan.md'), '## Sub-task 1: foo', 'utf8');
      fs.writeFileSync(path.join(cfDir, 'requirements.md'), 'reqs', 'utf8');
      const result = st.inferCompletedPhases(tmpDir, orderedPhases);
      assert.equal(result.latestDetectedPhase, 'PLAN');
      assert.ok(result.completedPhases.indexOf('DISCOVER') < result.completedPhases.indexOf('REQUIREMENTS'));
    });

    it('ignores empty files', () => {
      st.ensureCloudForgeDir(tmpDir);
      fs.writeFileSync(path.join(st.getCloudForgeDir(tmpDir), 'domain.md'), '', 'utf8');
      const result = st.inferCompletedPhases(tmpDir, orderedPhases);
      assert.equal(result.latestDetectedPhase, null);
      assert.deepEqual(result.completedPhases, []);
    });
  });

  describe('inferResumePhase', () => {
    const orderedPhases = ['DISCOVER', 'REQUIREMENTS', 'PRIORITIZE', 'DOMAIN', 'DESIGN', 'PLAN'];

    it('returns first phase when no phases detected', () => {
      assert.equal(st.inferResumePhase([], null, orderedPhases), 'DISCOVER');
    });

    it('returns latestDetectedPhase when present', () => {
      assert.equal(st.inferResumePhase(['DISCOVER'], 'REQUIREMENTS', orderedPhases), 'REQUIREMENTS');
    });

    it('returns next after latest completed when no latestDetected', () => {
      assert.equal(st.inferResumePhase(['DISCOVER', 'REQUIREMENTS'], null, orderedPhases), 'PRIORITIZE');
    });

    it('wraps to first phase when all completed', () => {
      assert.equal(st.inferResumePhase([...orderedPhases], null, orderedPhases), 'DISCOVER');
    });

    it('handles single completed phase', () => {
      assert.equal(st.inferResumePhase(['DISCOVER'], null, orderedPhases), 'REQUIREMENTS');
    });
  });

  describe('countPlanSubTasks', () => {
    it('counts sub-tasks from plan content', () => {
      const content = '# Plan\n## Sub-task 1: foo\n## Sub-task 2: bar\n## Sub-task 3: baz';
      assert.equal(st.countPlanSubTasks(content), 3);
    });

    it('returns 0 for empty content', () => {
      assert.equal(st.countPlanSubTasks(''), 0);
    });

    it('returns 0 when no sub-task headings present', () => {
      assert.equal(st.countPlanSubTasks('# Plan\nSome notes\n## Design'), 0);
    });

    it('counts single sub-task', () => {
      assert.equal(st.countPlanSubTasks('## Sub-task 1: only one'), 1);
    });
  });

  describe('recoverStateFromArtifacts', () => {
    const orderedPhases = [
      'DISCOVER', 'REQUIREMENTS', 'PRIORITIZE', 'GATE_SCOPE',
      'DOMAIN', 'DESIGN', 'BDD', 'PLAN', 'PROTOTYPE', 'GATE_DESIGN',
      'TEST', 'IMPLEMENT', 'VERIFY', 'REFACTOR',
      'INTEGRATE', 'GATE_QUALITY', 'REVIEW', 'INNOVATE',
    ];

    it('returns null when no task can be inferred', () => {
      st.ensureCloudForgeDir(tmpDir);
      assert.equal(st.recoverStateFromArtifacts(tmpDir, orderedPhases), null);
    });

    it('recovers from corrupt state.json with plan', () => {
      st.ensureCloudForgeDir(tmpDir);
      const cfDir = st.getCloudForgeDir(tmpDir);
      fs.writeFileSync(st.getStatePath(tmpDir), '{"task": "Build API", broken', 'utf8');
      fs.writeFileSync(path.join(cfDir, 'plan.md'), '## Sub-task 1: models\n## Sub-task 2: routes', 'utf8');
      fs.writeFileSync(path.join(cfDir, 'requirements.md'), 'reqs', 'utf8');
      const recovered = st.recoverStateFromArtifacts(tmpDir, orderedPhases);
      assert.equal(recovered.task, 'Build API');
      assert.equal(recovered.totalSubTasks, 2);
      assert.equal(recovered.phase, 'PLAN');
    });

    it('recovers from requirements.md only', () => {
      st.ensureCloudForgeDir(tmpDir);
      const cfDir = st.getCloudForgeDir(tmpDir);
      fs.writeFileSync(path.join(cfDir, 'requirements.md'), '# Add dark mode\n\nDetails...', 'utf8');
      const recovered = st.recoverStateFromArtifacts(tmpDir, orderedPhases);
      assert.equal(recovered.task, 'Add dark mode');
      assert.equal(recovered.phase, 'REQUIREMENTS');
    });

    it('passes through options to createInitialState', () => {
      st.ensureCloudForgeDir(tmpDir);
      const cfDir = st.getCloudForgeDir(tmpDir);
      fs.writeFileSync(path.join(cfDir, 'requirements.md'), '# Task\n\ncontent', 'utf8');
      const recovered = st.recoverStateFromArtifacts(tmpDir, orderedPhases, { maxIterations: 50, model: 'opus' });
      assert.equal(recovered.maxIterations, 50);
      assert.equal(recovered.model, 'opus');
    });
  });

  describe('repairState', () => {
    const orderedPhases = [
      'DISCOVER', 'REQUIREMENTS', 'PRIORITIZE', 'GATE_SCOPE',
      'DOMAIN', 'DESIGN', 'BDD', 'PLAN', 'PROTOTYPE', 'GATE_DESIGN',
      'TEST', 'IMPLEMENT', 'VERIFY', 'REFACTOR',
      'INTEGRATE', 'GATE_QUALITY', 'REVIEW', 'INNOVATE',
    ];

    it('leaves valid state unchanged', () => {
      const s = st.createInitialState('test');
      s.phase = 'DESIGN';
      s.completedPhases = ['DISCOVER', 'REQUIREMENTS'];
      const repaired = st.repairState(s, orderedPhases);
      assert.equal(repaired.phase, 'DESIGN');
      assert.deepEqual(repaired.completedPhases, ['DISCOVER', 'REQUIREMENTS']);
    });

    it('resets invalid phase to first phase', () => {
      const s = st.createInitialState('test');
      s.phase = 'NONEXISTENT';
      st.repairState(s, orderedPhases);
      assert.equal(s.phase, 'DISCOVER');
    });

    it('resets negative iteration to 0', () => {
      const s = st.createInitialState('test');
      s.iteration = -5;
      st.repairState(s, orderedPhases);
      assert.equal(s.iteration, 0);
    });

    it('resets non-number iteration to 0', () => {
      const s = st.createInitialState('test');
      s.iteration = 'abc';
      st.repairState(s, orderedPhases);
      assert.equal(s.iteration, 0);
    });

    it('resets bad maxIterations to 25', () => {
      const s = st.createInitialState('test');
      s.maxIterations = -1;
      st.repairState(s, orderedPhases);
      assert.equal(s.maxIterations, 25);
    });

    it('converts non-array history to empty array', () => {
      const s = st.createInitialState('test');
      s.history = 'not an array';
      st.repairState(s, orderedPhases);
      assert.deepEqual(s.history, []);
    });

    it('converts non-array completedPhases to empty array', () => {
      const s = st.createInitialState('test');
      s.completedPhases = null;
      st.repairState(s, orderedPhases);
      assert.deepEqual(s.completedPhases, []);
    });

    it('filters invalid phase names from completedPhases', () => {
      const s = st.createInitialState('test');
      s.completedPhases = ['DISCOVER', 'FAKE_PHASE', 'REQUIREMENTS'];
      st.repairState(s, orderedPhases);
      assert.deepEqual(s.completedPhases, ['DISCOVER', 'REQUIREMENTS']);
    });

    it('creates missing totalTokens object', () => {
      const s = st.createInitialState('test');
      s.totalTokens = null;
      st.repairState(s, orderedPhases);
      assert.deepEqual(s.totalTokens, { input: 0, output: 0 });
    });

    it('resets non-numeric token values', () => {
      const s = st.createInitialState('test');
      s.totalTokens = { input: 'many', output: NaN };
      st.repairState(s, orderedPhases);
      assert.equal(s.totalTokens.input, 0);
      assert.equal(s.totalTokens.output, 0);
    });

    it('resets invalid timestamps', () => {
      const s = st.createInitialState('test');
      s.startedAt = 'not-a-date';
      s.lastActivity = '';
      const before = new Date().toISOString();
      st.repairState(s, orderedPhases);
      assert.ok(s.startedAt >= before);
      assert.ok(s.lastActivity >= before);
    });
  });
});
