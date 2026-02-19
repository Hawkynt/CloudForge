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
});
