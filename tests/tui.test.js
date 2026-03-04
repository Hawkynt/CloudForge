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

describe('tui infrastructure', () => {
  describe('stripAnsi', () => {
    it('removes ANSI color codes from string', () => {
      const input = '\x1b[31mhello\x1b[0m world';
      assert.equal(tui.stripAnsi(input), 'hello world');
    });

    it('returns plain string unchanged', () => {
      assert.equal(tui.stripAnsi('hello'), 'hello');
    });

    it('handles empty string', () => {
      assert.equal(tui.stripAnsi(''), '');
    });

    it('strips multiple nested codes', () => {
      const input = '\x1b[1m\x1b[36mBOLD CYAN\x1b[0m';
      assert.equal(tui.stripAnsi(input), 'BOLD CYAN');
    });
  });

  describe('getTermWidth', () => {
    it('returns a positive number', () => {
      const w = tui.getTermWidth();
      assert.ok(w > 0);
    });

    it('returns 80 when stdout.columns is undefined', () => {
      const orig = process.stdout.columns;
      process.stdout.columns = undefined;
      const w = tui.getTermWidth();
      process.stdout.columns = orig;
      assert.equal(w, 80);
    });
  });

  describe('padLine', () => {
    it('pads plain string to target width', () => {
      const result = tui.padLine('hi', 10);
      assert.equal(result.length, 10);
      assert.ok(result.startsWith('hi'));
    });

    it('pads string with ANSI codes to visible width', () => {
      const input = '\x1b[31mhi\x1b[0m';
      const result = tui.padLine(input, 10);
      const visible = tui.stripAnsi(result);
      assert.equal(visible.length, 10);
    });

    it('truncates long strings with ellipsis', () => {
      const result = tui.padLine('a very long string here', 10);
      assert.ok(tui.stripAnsi(result).includes('...'));
    });

    it('returns string unchanged if exact width', () => {
      const result = tui.padLine('exact', 5);
      assert.equal(tui.stripAnsi(result).length, 5);
    });
  });

  describe('box', () => {
    it('renders box with title', () => {
      const output = tui.box('Title', ['line 1', 'line 2'], { width: 40 });
      const plain = tui.stripAnsi(output);
      assert.ok(plain.includes('\u250C'));
      assert.ok(plain.includes('\u2510'));
      assert.ok(plain.includes('\u2514'));
      assert.ok(plain.includes('\u2518'));
      assert.ok(plain.includes('Title'));
      assert.ok(plain.includes('line 1'));
      assert.ok(plain.includes('line 2'));
    });

    it('renders box without title', () => {
      const output = tui.box(null, ['content'], { width: 30 });
      const plain = tui.stripAnsi(output);
      assert.ok(plain.includes('\u250C'));
      assert.ok(plain.includes('content'));
    });

    it('uses specified width', () => {
      const output = tui.box('T', ['x'], { width: 50 });
      const lines = output.split('\n');
      const topVisible = tui.stripAnsi(lines[0]);
      assert.equal(topVisible.length, 50);
    });

    it('handles empty lines array', () => {
      const output = tui.box('Empty', [], { width: 30 });
      const lines = output.split('\n');
      assert.equal(lines.length, 2); // top + bottom only
    });
  });

  describe('dashboardBar', () => {
    it('shows empty bar at 0 progress', () => {
      const bar = tui.dashboardBar(0, 10, 10);
      assert.ok(bar.startsWith('['));
      assert.ok(bar.includes(']'));
      assert.ok(tui.stripAnsi(bar).includes('          ')); // all spaces
    });

    it('shows filled bar at full progress', () => {
      const bar = tui.dashboardBar(10, 10, 10);
      const plain = tui.stripAnsi(bar);
      assert.ok(plain.includes('='));
      assert.ok(!plain.includes('>'));
    });

    it('shows cursor at partial progress', () => {
      const bar = tui.dashboardBar(5, 10, 10);
      const plain = tui.stripAnsi(bar);
      assert.ok(plain.includes('>'));
    });

    it('handles zero total', () => {
      const bar = tui.dashboardBar(0, 0, 10);
      const plain = tui.stripAnsi(bar);
      assert.equal(plain, '[          ]');
    });

    it('accepts custom color', () => {
      const bar = tui.dashboardBar(5, 10, 10, '\x1b[33m');
      assert.ok(bar.includes('\x1b[33m'));
    });
  });

  describe('PHASE_GROUPS', () => {
    it('has 4 groups', () => {
      assert.equal(tui.PHASE_GROUPS.length, 4);
    });

    it('covers all 18 phases', () => {
      const all = tui.PHASE_GROUPS.flatMap(g => g.phases);
      assert.equal(all.length, 18);
    });

    it('groups have labels', () => {
      for (const g of tui.PHASE_GROUPS)
        assert.ok(g.label.length > 0);
    });

    it('Discovery group has 4 phases', () => {
      assert.equal(tui.PHASE_GROUPS[0].phases.length, 4);
      assert.equal(tui.PHASE_GROUPS[0].label, 'Discovery');
    });
  });
});

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

    it('phaseBanner with sessionStart shows session iteration and total', () => {
      tui.phaseBanner('VERIFY', null, null, 52, 150, { input: 0, output: 0 }, 50);
      assert.ok(capture.output.includes('2/100'));
      assert.ok(capture.output.includes('(total: 52)'));
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
      assert.ok(capture.output.includes('Re-run without arguments to auto-resume'));
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
      assert.ok(capture.output.includes('(session: 5)'));
    });

    it('finalSummary shows session count for resumed run', () => {
      const mockState = {
        task: 'resumed task',
        iteration: 55,
        maxIterations: 150,
        sessionStartIteration: 50,
        totalTokens: { input: 10000, output: 5000 },
        startedAt: new Date(Date.now() - 30000).toISOString(),
      };
      tui.finalSummary(mockState);
      assert.ok(capture.output.includes('55/150'));
      assert.ok(capture.output.includes('(session: 5)'));
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
      const all = tui.PHASE_GROUPS.flatMap(g => g.phases);
      tui.phaseProgressLine(all, ['DISCOVER', 'REQUIREMENTS'], 'DESIGN');
      assert.ok(capture.output.includes('#'));
      assert.ok(capture.output.includes('>'));
      assert.ok(capture.output.includes('-'));
      assert.ok(capture.output.includes('6/18'));
    });

    it('phaseProgressLine handles first phase with no completed', () => {
      const all = tui.PHASE_GROUPS.flatMap(g => g.phases);
      tui.phaseProgressLine(all, [], 'DISCOVER');
      assert.ok(capture.output.includes('>'));
      assert.ok(capture.output.includes('1/18'));
    });

    it('phaseProgressLine handles last phase all completed', () => {
      const all = tui.PHASE_GROUPS.flatMap(g => g.phases);
      const allButLast = all.slice(0, -1);
      tui.phaseProgressLine(all, allButLast, 'INNOVATE');
      assert.ok(capture.output.includes('18/18'));
    });

    it('phaseProgressLine shows group labels', () => {
      const all = tui.PHASE_GROUPS.flatMap(g => g.phases);
      tui.phaseProgressLine(all, [], 'DISCOVER');
      assert.ok(capture.output.includes('Discovery'));
      assert.ok(capture.output.includes('Design'));
      assert.ok(capture.output.includes('Task Loop'));
      assert.ok(capture.output.includes('Integration'));
    });

    it('phaseProgressLine shows current phase pointer', () => {
      const all = tui.PHASE_GROUPS.flatMap(g => g.phases);
      tui.phaseProgressLine(all, ['DISCOVER'], 'REQUIREMENTS');
      assert.ok(capture.output.includes('^ REQUIREMENTS'));
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

    it('banner renders box-drawing characters', () => {
      tui.banner('boxed task', 'sonnet', 50);
      assert.ok(capture.output.includes('\u250C')); // top-left corner
      assert.ok(capture.output.includes('\u2518')); // bottom-right corner
      assert.ok(capture.output.includes('boxed task'));
    });

    it('banner shows resume info when options.isResume is true', () => {
      tui.banner('resume task', 'opus', 100, { isResume: true, iteration: 42 });
      assert.ok(capture.output.includes('Resumed'));
      assert.ok(capture.output.includes('42'));
    });

    it('phaseBanner renders box-drawing characters', () => {
      tui.phaseBanner('DESIGN', null, null, 5, 50, { input: 1000, output: 500 });
      assert.ok(capture.output.includes('\u250C'));
      assert.ok(capture.output.includes('DESIGN'));
    });

    it('errorMessage includes cross mark indicator', () => {
      tui.errorMessage('test error');
      assert.ok(capture.output.includes('\u2717'));
      assert.ok(capture.output.includes('ERROR'));
    });

    it('warnMessage includes warning indicator', () => {
      tui.warnMessage('test warning');
      assert.ok(capture.output.includes('\u26A0'));
      assert.ok(capture.output.includes('WARN'));
    });

    it('successMessage includes check mark indicator', () => {
      tui.successMessage('test success');
      assert.ok(capture.output.includes('\u2713'));
      assert.ok(capture.output.includes('DONE'));
    });

    it('haltMessage renders as a box', () => {
      tui.haltMessage('budget exceeded');
      assert.ok(capture.output.includes('\u250C'));
      assert.ok(capture.output.includes('budget exceeded'));
    });

    it('rateLimitBanner renders as a box', () => {
      tui.rateLimitBanner(120, 2, 5);
      assert.ok(capture.output.includes('\u250C'));
      assert.ok(capture.output.includes('RATE LIMITED'));
      assert.ok(capture.output.includes('2:00'));
      assert.ok(capture.output.includes('2/5'));
    });

    it('dryRunSummary renders as a box with numbered phases', () => {
      tui.dryRunSummary(['DISCOVER', 'REQUIREMENTS']);
      assert.ok(capture.output.includes('\u250C'));
      assert.ok(capture.output.includes('DRY RUN'));
      assert.ok(capture.output.includes('1.'));
      assert.ok(capture.output.includes('2.'));
    });

    it('completedPhasesList renders check marks', () => {
      tui.completedPhasesList(['DISCOVER', 'REQUIREMENTS']);
      assert.ok(capture.output.includes('\u2713'));
      assert.ok(capture.output.includes('DISCOVER'));
    });

    it('finalSummary renders as a box with KPI breakdown', () => {
      const mockState = {
        task: 'kpi task',
        iteration: 20,
        maxIterations: 100,
        totalTokens: { input: 100000, output: 30000 },
        startedAt: new Date(Date.now() - 120000).toISOString(),
        history: [
          { result: 'DONE' }, { result: 'DONE' }, { result: 'NEEDS_RETRY' },
          { result: 'DONE' }, { result: 'BLOCKED' },
        ],
        completedPhases: ['DISCOVER', 'REQUIREMENTS', 'PRIORITIZE'],
        currentSubTask: 3,
        totalSubTasks: 5,
      };
      tui.finalSummary(mockState);
      const out = capture.output;
      assert.ok(out.includes('\u250C'));
      assert.ok(out.includes('CLOUDFORGE COMPLETE'));
      assert.ok(out.includes('DONE 3'));
      assert.ok(out.includes('RETRY 1'));
      assert.ok(out.includes('BLOCKED 1'));
      assert.ok(out.includes('3/18'));
      assert.ok(out.includes('3/5'));
      assert.ok(out.includes('60%'));
    });
  });
});

describe('phaseResultBox', () => {
  let capture;
  const captureStdoutLocal = () => {
    const chunks = [];
    const original = process.stdout.write;
    process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
    return { get output() { return chunks.join(''); }, restore() { process.stdout.write = original; } };
  };

  beforeEach(() => { capture = captureStdoutLocal(); });
  afterEach(() => { capture.restore(); });

  it('renders DONE result with check mark', () => {
    tui.phaseResultBox('DESIGN', 'DONE', 'Architecture complete', { input: 5000, output: 2000 }, 'BDD');
    const out = capture.output;
    assert.ok(out.includes('Result'));
    assert.ok(out.includes('DESIGN'));
    assert.ok(out.includes('DONE'));
    assert.ok(out.includes('\u2713'));
    assert.ok(out.includes('BDD'));
  });

  it('renders NEEDS_RETRY result with retry icon', () => {
    tui.phaseResultBox('TEST', 'NEEDS_RETRY', 'Tests failing', { input: 3000, output: 1000 }, 'TEST');
    const out = capture.output;
    assert.ok(out.includes('NEEDS_RETRY'));
    assert.ok(out.includes('\u21BB'));
  });

  it('renders BLOCKED result with cross mark', () => {
    tui.phaseResultBox('VERIFY', 'BLOCKED', 'Cannot proceed', { input: 1000, output: 500 }, null);
    const out = capture.output;
    assert.ok(out.includes('BLOCKED'));
    assert.ok(out.includes('\u2717'));
    assert.ok(out.includes('COMPLETE'));
  });

  it('shows COMPLETE when nextPhase is null', () => {
    tui.phaseResultBox('INNOVATE', 'DONE', 'All done', { input: 1000, output: 500 }, null);
    assert.ok(capture.output.includes('COMPLETE'));
  });

  it('shows next phase name', () => {
    tui.phaseResultBox('DISCOVER', 'DONE', 'Found everything', { input: 2000, output: 800 }, 'REQUIREMENTS');
    assert.ok(capture.output.includes('REQUIREMENTS'));
    assert.ok(capture.output.includes('->'));
  });

  it('renders box-drawing characters', () => {
    tui.phaseResultBox('PLAN', 'DONE', 'Plan ready', { input: 1000, output: 500 }, 'TEST');
    assert.ok(capture.output.includes('\u250C'));
    assert.ok(capture.output.includes('\u2518'));
  });

  it('handles missing summary gracefully', () => {
    tui.phaseResultBox('DESIGN', 'DONE', null, { input: 1000, output: 500 }, 'BDD');
    assert.ok(capture.output.includes('DESIGN'));
    assert.ok(capture.output.includes('DONE'));
  });

  it('handles missing tokens gracefully', () => {
    tui.phaseResultBox('DESIGN', 'DONE', 'Done', null, 'BDD');
    assert.ok(capture.output.includes('0'));
  });
});

describe('kpiDashboard', () => {
  let capture;
  const captureStdoutLocal = () => {
    const chunks = [];
    const original = process.stdout.write;
    process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
    return { get output() { return chunks.join(''); }, restore() { process.stdout.write = original; } };
  };

  beforeEach(() => { capture = captureStdoutLocal(); });
  afterEach(() => { capture.restore(); });

  it('renders dashboard box with phase info', () => {
    const allPhases = tui.PHASE_GROUPS.flatMap(g => g.phases);
    const wfState = {
      phase: 'DESIGN',
      iteration: 5,
      maxIterations: 100,
      sessionStartIteration: 0,
      totalTokens: { input: 50000, output: 12000 },
      startedAt: new Date(Date.now() - 60000).toISOString(),
      consecutiveRetries: 0,
    };
    tui.kpiDashboard(wfState, { result: 'DONE' }, allPhases);
    const out = capture.output;
    assert.ok(out.includes('Dashboard'));
    assert.ok(out.includes('Phase'));
    assert.ok(out.includes('DESIGN'));
    assert.ok(out.includes('5/100'));
    assert.ok(out.includes('healthy'));
  });

  it('shows sub-task row when totalSubTasks > 0', () => {
    const allPhases = tui.PHASE_GROUPS.flatMap(g => g.phases);
    const wfState = {
      phase: 'IMPLEMENT',
      iteration: 10,
      maxIterations: 100,
      sessionStartIteration: 0,
      totalTokens: { input: 80000, output: 20000 },
      startedAt: new Date(Date.now() - 120000).toISOString(),
      consecutiveRetries: 0,
      currentSubTask: 2,
      totalSubTasks: 5,
    };
    tui.kpiDashboard(wfState, { result: 'DONE' }, allPhases);
    assert.ok(capture.output.includes('Sub-task'));
    assert.ok(capture.output.includes('2/5'));
  });

  it('hides sub-task row when totalSubTasks is 0', () => {
    const allPhases = tui.PHASE_GROUPS.flatMap(g => g.phases);
    const wfState = {
      phase: 'DISCOVER',
      iteration: 1,
      maxIterations: 100,
      sessionStartIteration: 0,
      totalTokens: { input: 5000, output: 1000 },
      consecutiveRetries: 0,
      totalSubTasks: 0,
    };
    tui.kpiDashboard(wfState, null, allPhases);
    assert.ok(!tui.stripAnsi(capture.output).includes('Sub-task'));
  });

  it('shows yellow retry indicator for 1 retry', () => {
    const allPhases = tui.PHASE_GROUPS.flatMap(g => g.phases);
    const wfState = {
      phase: 'TEST',
      iteration: 8,
      maxIterations: 100,
      sessionStartIteration: 0,
      totalTokens: { input: 30000, output: 10000 },
      consecutiveRetries: 1,
    };
    tui.kpiDashboard(wfState, { result: 'NEEDS_RETRY' }, allPhases);
    assert.ok(capture.output.includes('1 retry'));
    assert.ok(capture.output.includes('NEEDS_RETRY'));
  });

  it('shows red retry indicator for 2+ retries', () => {
    const allPhases = tui.PHASE_GROUPS.flatMap(g => g.phases);
    const wfState = {
      phase: 'VERIFY',
      iteration: 12,
      maxIterations: 100,
      sessionStartIteration: 0,
      totalTokens: { input: 40000, output: 15000 },
      consecutiveRetries: 3,
    };
    tui.kpiDashboard(wfState, { result: 'BLOCKED' }, allPhases);
    assert.ok(capture.output.includes('3 consecutive'));
    assert.ok(capture.output.includes('BLOCKED'));
  });

  it('uses red iteration bar when budget >80% consumed', () => {
    const allPhases = tui.PHASE_GROUPS.flatMap(g => g.phases);
    const wfState = {
      phase: 'REVIEW',
      iteration: 85,
      maxIterations: 100,
      sessionStartIteration: 0,
      totalTokens: { input: 200000, output: 80000 },
      consecutiveRetries: 0,
    };
    tui.kpiDashboard(wfState, { result: 'DONE' }, allPhases);
    assert.ok(capture.output.includes('85/100'));
  });

  it('shows elapsed time', () => {
    const allPhases = tui.PHASE_GROUPS.flatMap(g => g.phases);
    const wfState = {
      phase: 'DISCOVER',
      iteration: 1,
      maxIterations: 100,
      sessionStartIteration: 0,
      totalTokens: { input: 1000, output: 500 },
      startedAt: new Date(Date.now() - 90000).toISOString(),
      consecutiveRetries: 0,
    };
    tui.kpiDashboard(wfState, null, allPhases);
    assert.ok(capture.output.includes('Elapsed'));
    assert.ok(capture.output.includes('1:30'));
  });

  it('shows session iteration count', () => {
    const allPhases = tui.PHASE_GROUPS.flatMap(g => g.phases);
    const wfState = {
      phase: 'DESIGN',
      iteration: 55,
      maxIterations: 200,
      sessionStartIteration: 50,
      totalTokens: { input: 10000, output: 5000 },
      consecutiveRetries: 0,
    };
    tui.kpiDashboard(wfState, { result: 'DONE' }, allPhases);
    assert.ok(capture.output.includes('(sess: 5)'));
  });
});
