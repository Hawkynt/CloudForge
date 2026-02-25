'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const tui = require('../lib/tui');

// Capture stdout writes for testing
function captureStdout() {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  return {
    get output() { return chunks.join(''); },
    restore() { process.stdout.write = original; },
  };
}

describe('tui', () => {
  describe('formatTime', () => {
    it('formats seconds only when under a minute', () => {
      assert.equal(tui.formatTime(45), '45s');
    });

    it('formats zero seconds', () => {
      assert.equal(tui.formatTime(0), '0s');
    });

    it('formats minutes and seconds', () => {
      assert.equal(tui.formatTime(90), '1:30');
    });

    it('formats exact minutes', () => {
      assert.equal(tui.formatTime(120), '2:00');
    });

    it('pads seconds with leading zero', () => {
      assert.equal(tui.formatTime(65), '1:05');
    });
  });

  describe('formatTokenCount', () => {
    it('returns raw number for small counts', () => {
      assert.equal(tui.formatTokenCount(500), '500');
    });

    it('formats thousands with K suffix', () => {
      assert.equal(tui.formatTokenCount(5000), '5K');
    });

    it('formats millions with M suffix', () => {
      assert.equal(tui.formatTokenCount(1_500_000), '1.5M');
    });

    it('rounds thousands', () => {
      assert.equal(tui.formatTokenCount(12_345), '12K');
    });

    it('handles zero', () => {
      assert.equal(tui.formatTokenCount(0), '0');
    });

    it('handles boundary at 1000', () => {
      assert.equal(tui.formatTokenCount(1000), '1K');
    });
  });

  describe('progressBar', () => {
    it('shows empty bar at 0 progress', () => {
      const bar = tui.progressBar(0, 10, 10);
      assert.ok(bar.includes('0/10'));
    });

    it('shows full bar at max progress', () => {
      const bar = tui.progressBar(10, 10, 10);
      assert.ok(bar.includes('10/10'));
    });

    it('handles zero total', () => {
      const bar = tui.progressBar(0, 0, 10);
      assert.ok(bar.includes('0/0'));
    });
  });

  describe('timestamp', () => {
    it('returns HH:MM:SS format', () => {
      const ts = tui.timestamp();
      assert.match(ts, /^\d{2}:\d{2}:\d{2}$/);
    });

    it('returns current time', () => {
      const ts = tui.timestamp();
      const now = new Date();
      const expected = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      assert.ok(ts.startsWith(expected), `expected ${ts} to start with ${expected}`);
    });
  });

  describe('color helpers', () => {
    it('wraps text with ANSI reset', () => {
      const result = tui.color.bold('test');
      assert.ok(result.includes('test'));
      assert.ok(result.includes('\x1b['));
    });

    it('all color functions return strings containing the input', () => {
      const fns = ['bold', 'dim', 'italic', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
      for (const fn of fns)
        assert.ok(tui.color[fn]('hello').includes('hello'), `${fn} should contain input text`);
    });
  });

  describe('output functions', () => {
    let capture;

    beforeEach(() => { capture = captureStdout(); });
    afterEach(() => { capture.restore(); });

    it('banner outputs task and model info', () => {
      tui.banner('test task', 'opus', 25);
      assert.ok(capture.output.includes('CLOUDFORGE'));
      assert.ok(capture.output.includes('test task'));
      assert.ok(capture.output.includes('opus'));
      assert.ok(capture.output.includes('25'));
    });

    it('phaseBanner shows phase name and iteration', () => {
      tui.phaseBanner('ANALYZE', null, null, 1, 25, { input: 0, output: 0 });
      assert.ok(capture.output.includes('ANALYZE'));
      assert.ok(capture.output.includes('1/25'));
    });

    it('phaseBanner shows sub-task info when provided', () => {
      tui.phaseBanner('IMPLEMENT', 2, 5, 3, 25, { input: 5000, output: 1000 });
      assert.ok(capture.output.includes('IMPLEMENT'));
      assert.ok(capture.output.includes('2/5'));
      assert.ok(capture.output.includes('3/25'));
    });

    it('toolCallLine shows tool name and args', () => {
      tui.toolCallLine('bash', 'npm test');
      assert.ok(capture.output.includes('bash'));
      assert.ok(capture.output.includes('npm test'));
    });

    it('toolCallLine truncates long args', () => {
      const longArg = 'x'.repeat(100);
      tui.toolCallLine('bash', longArg);
      assert.ok(capture.output.includes('...'));
    });

    it('errorMessage includes ERROR prefix', () => {
      tui.errorMessage('something broke');
      assert.ok(capture.output.includes('ERROR'));
      assert.ok(capture.output.includes('something broke'));
    });

    it('successMessage includes DONE prefix', () => {
      tui.successMessage('all good');
      assert.ok(capture.output.includes('DONE'));
      assert.ok(capture.output.includes('all good'));
    });

    it('haltMessage includes state save hint', () => {
      tui.haltMessage('stuck in loop');
      assert.ok(capture.output.includes('HALTED'));
      assert.ok(capture.output.includes('stuck in loop'));
      assert.ok(capture.output.includes('re-run without arguments to auto-resume'));
    });

    it('dryRunSummary lists phases', () => {
      tui.dryRunSummary(['ANALYZE', 'DESIGN', 'PLAN']);
      assert.ok(capture.output.includes('DRY RUN'));
      assert.ok(capture.output.includes('ANALYZE'));
      assert.ok(capture.output.includes('DESIGN'));
      assert.ok(capture.output.includes('PLAN'));
    });

    it('finalSummary shows completion info', () => {
      const mockState = {
        task: 'test task',
        iteration: 5,
        maxIterations: 25,
        totalTokens: { input: 50000, output: 12000 },
        startedAt: new Date(Date.now() - 60000).toISOString(),
      };
      tui.finalSummary(mockState);
      assert.ok(capture.output.includes('CLOUDFORGE COMPLETE'));
      assert.ok(capture.output.includes('test task'));
      assert.ok(capture.output.includes('5/25'));
    });

    it('completedPhasesList renders chain of completed phases', () => {
      tui.completedPhasesList(['ANALYZE', 'DESIGN']);
      assert.ok(capture.output.includes('Completed'));
      assert.ok(capture.output.includes('ANALYZE'));
      assert.ok(capture.output.includes('DESIGN'));
    });

    it('completedPhasesList does nothing for empty array', () => {
      tui.completedPhasesList([]);
      assert.equal(capture.output, '');
    });

    it('phaseProgressLine shows markers for completed, current, and pending phases', () => {
      const all = ['DISCOVER', 'REQUIREMENTS', 'DESIGN', 'PLAN', 'IMPLEMENT', 'REVIEW'];
      tui.phaseProgressLine(all, ['DISCOVER', 'REQUIREMENTS'], 'DESIGN');
      assert.ok(capture.output.includes('#'));
      assert.ok(capture.output.includes('>'));
      assert.ok(capture.output.includes('-'));
      assert.ok(capture.output.includes('3/6'));
    });

    it('phaseProgressLine handles first phase with no completed', () => {
      const all = ['DISCOVER', 'REQUIREMENTS', 'DESIGN'];
      tui.phaseProgressLine(all, [], 'DISCOVER');
      assert.ok(capture.output.includes('>'));
      assert.ok(capture.output.includes('1/3'));
    });

    it('phaseProgressLine handles last phase all completed', () => {
      const all = ['DISCOVER', 'REQUIREMENTS', 'DESIGN'];
      tui.phaseProgressLine(all, ['DISCOVER', 'REQUIREMENTS'], 'DESIGN');
      assert.ok(capture.output.includes('3/3'));
    });

    it('toolCallLine inserts newline when streamText did not end with one', () => {
      tui.streamText('some text without newline');
      tui.toolCallLine('Bash', 'npm test');
      assert.ok(capture.output.startsWith('some text without newline\n'), 'should insert newline before tool call');
      assert.ok(capture.output.includes('Bash'));
      assert.ok(capture.output.includes('npm test'));
    });

    it('toolCallLine does not double-newline when streamText ended with one', () => {
      tui.streamText('some text\n');
      tui.toolCallLine('Bash', 'npm test');
      assert.ok(!capture.output.includes('some text\n\n  '), 'should not double-newline');
      assert.ok(capture.output.includes('Bash'));
    });

    it('ensureNewline is a no-op at start of output', () => {
      tui.ensureNewline();
      assert.equal(capture.output, '');
    });

    it('ensureNewline emits newline after partial streamText', () => {
      tui.streamText('partial');
      tui.ensureNewline();
      assert.equal(capture.output, 'partial\n');
    });
  });
});
