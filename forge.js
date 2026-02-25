#!/usr/bin/env node
'use strict';

const path = require('path');
const tui = require('./lib/tui');
const runner = require('./lib/runner');
const ratelimit = require('./lib/ratelimit');
const phases = require('./lib/phases');
const state = require('./lib/state');

// ── CLI Argument Parsing ──

function parseArgs(argv) {
  const args = {
    task: null,
    maxIterations: 100,
    maxPhaseRetries: 3,
    model: null,
    workingDir: process.cwd(),
    maxTurns: 50,
    continueSession: null,
    dryRun: false,
    rateLimitWait: 43200,
    cliPath: null,
    verbose: false,
  };

  const positional = [];
  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i];
    switch (arg) {
      case '--max-iterations':
        args.maxIterations = parseInt(argv[++i], 10);
        break;
      case '--max-phase-retries':
        args.maxPhaseRetries = parseInt(argv[++i], 10);
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--working-dir':
        args.workingDir = path.resolve(argv[++i]);
        break;
      case '--max-turns':
        args.maxTurns = parseInt(argv[++i], 10);
        break;
      case '--continue-session':
        args.continueSession = argv[++i];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--rate-limit-wait':
        args.rateLimitWait = parseInt(argv[++i], 10);
        break;
      case '--cli-path':
        args.cliPath = argv[++i];
        break;
      case '--verbose':
      case '-v':
        args.verbose = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        if (!arg.startsWith('--'))
          positional.push(arg);
        break;
    }
  }

  if (positional.length > 0)
    args.task = positional.join(' ');

  return args;
}

function printUsage() {
  const text = `
Usage: cloudforge <task> [options]

Arguments:
  <task>                  Task description (required unless --continue-session)

Options:
  --max-iterations <n>    Max agent invocations (default: 25)
  --max-phase-retries <n> Max retries per phase (default: 3)
  --model <name>          Model to use: sonnet|opus|haiku
  --working-dir <path>    Project directory (default: cwd)
  --max-turns <n>         Max agentic turns per invocation (default: 50)
  --continue-session <id> Resume a previous CloudForge session
  --dry-run               Show planned phases without executing
  --rate-limit-wait <s>   Max seconds to wait on rate limit (default: 43200/12h)
  --cli-path <path>       Path to agent CLI
  -v, --verbose           Show debug output (spawn cmd, stderr, events)
  -h, --help              Show this help
`;
  process.stdout.write(text);
}

// ── Main Orchestrator ──

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Validate
  if (!args.task && !args.continueSession) {
    tui.errorMessage('No task provided. Use: cloudforge "your task description"');
    printUsage();
    return 1;
  }

  // Dry run mode
  if (args.dryRun) {
    tui.banner(args.task || '(no task)', args.model, args.maxIterations);
    tui.dryRunSummary(phases.getInitialPhaseSequence());
    return 0;
  }

  // Initialize or resume state
  let wfState;
  if (args.continueSession) {
    wfState = state.loadState(args.workingDir);
    if (!wfState) {
      tui.errorMessage(`No saved state found in ${args.workingDir}/.cloudforge/state.json`);
      return 1;
    }
    if (!args.task)
      args.task = wfState.task;
    tui.warnMessage(`Resuming session from phase: ${wfState.phase}, iteration: ${wfState.iteration}`);
  } else {
    wfState = state.createInitialState(args.task, {
      maxIterations: args.maxIterations,
      maxPhaseRetries: args.maxPhaseRetries,
      model: args.model,
      initialPhase: phases.getFirstPhase(),
    });
  }

  // Display banner
  tui.banner(args.task, args.model || 'default', args.maxIterations);

  // Get ordered phase list for progress visualization
  const allPhaseNames = phases.getOrderedPhaseNames();

  // Graceful shutdown
  let activeProcess = null;
  let shuttingDown = false;

  process.on('SIGINT', () => {
    if (shuttingDown) {
      process.exit(1); // Force exit on double Ctrl+C
    }
    shuttingDown = true;
    tui.warnMessage('Shutting down gracefully... saving state.');
    state.saveState(args.workingDir, wfState);
    if (activeProcess) {
      activeProcess.kill('SIGTERM');
    }
    process.exit(0);
  });

  // ── Phase Loop ──
  let currentPhase = wfState.phase;
  let phaseRetryCount = 0;

  while (currentPhase) {
    // Circuit breaker check
    const breaker = state.checkCircuitBreaker(wfState);
    if (breaker.halt) {
      state.saveState(args.workingDir, wfState);
      tui.haltMessage(breaker.reason);
      return 1;
    }

    if (shuttingDown) break;

    // Advance sub-task if entering TEST phase after completing a previous sub-task
    if (currentPhase === phases.PHASE_NAMES.TEST && !phases.isTaskLoopPhase(wfState.phase)) {
      // Entering task loop for the first time or moving to next sub-task
    }

    // Determine sub-task context
    const context = {
      subTaskNumber: wfState.currentSubTask,
      totalSubTasks: wfState.totalSubTasks,
      workingDir: args.workingDir,
      retryCount: phaseRetryCount,
      maxRetries: args.maxPhaseRetries,
    };

    // If entering TEST for a new sub-task, advance counter
    if (currentPhase === phases.PHASE_NAMES.TEST && phaseRetryCount === 0) {
      ++wfState.currentSubTask;
      context.subTaskNumber = wfState.currentSubTask;
    }

    // Display phase banner + progress
    tui.phaseBanner(
      currentPhase,
      phases.isTaskLoopPhase(currentPhase) ? wfState.currentSubTask : null,
      phases.isTaskLoopPhase(currentPhase) ? wfState.totalSubTasks : null,
      wfState.iteration + 1,
      wfState.maxIterations,
      wfState.totalTokens,
    );
    tui.phaseProgressLine(allPhaseNames, wfState.completedPhases, currentPhase);

    // Generate prompt
    const prompt = phases.getPromptForPhase(currentPhase, args.task, context);

    if (args.verbose) {
      tui.debug(`[phase] ${currentPhase} | subtask=${context.subTaskNumber}/${context.totalSubTasks} | retry=${phaseRetryCount}`);
      tui.debug(`[prompt] ${prompt.slice(0, 120)}...`);
      tui.debug(`[session] ${wfState.sessionId || '(new session)'}`);
    }

    // Invoke agent with rate limit retry loop
    let result = null;
    let rateLimitAttempt = 0;
    const maxRateLimitAttempts = 5;

    while (rateLimitAttempt < maxRateLimitAttempts) {
      result = await runner.runAgent(prompt, {
        sessionId: wfState.sessionId,
        model: args.model,
        maxTurns: args.maxTurns,
        workingDir: args.workingDir,
        cliPath: args.cliPath,
        verbose: args.verbose,
        onProcess: (proc) => { activeProcess = proc; },
      });

      activeProcess = null;

      if (args.verbose) {
        tui.debug(`[result] exit=${result.exitCode} success=${result.success} output=${result.output.length}chars stderr=${result.stderr.length}chars`);
        if (result.stderr)
          tui.debug(`[stderr] ${result.stderr.slice(0, 300)}`);
      }

      // Capture session ID
      if (result.sessionId)
        wfState.sessionId = result.sessionId;

      // Check for rate limit
      const rl = ratelimit.detectRateLimit(result.exitCode, result.stderr, result.output);
      if (rl.isRateLimit) {
        const shouldRetry = await ratelimit.handleRateLimit(
          rl.retryAfter, rateLimitAttempt, maxRateLimitAttempts, args.rateLimitWait,
        );
        if (!shouldRetry) {
          state.saveState(args.workingDir, wfState);
          tui.haltMessage('Rate limit wait exceeded. State saved.');
          return 1;
        }
        ++rateLimitAttempt;
        continue;
      }

      break; // No rate limit, proceed
    }

    if (rateLimitAttempt >= maxRateLimitAttempts) {
      state.saveState(args.workingDir, wfState);
      tui.haltMessage(`Rate limit: ${maxRateLimitAttempts} attempts exhausted. State saved.`);
      return 1;
    }

    tui.newline();

    // If agent process crashed (non-zero exit, no output), halt immediately
    if (!result.success && result.output.length === 0) {
      state.saveState(args.workingDir, wfState);
      tui.haltMessage(`Agent process failed (exit code ${result.exitCode}). Check stderr output above.`);
      return 1;
    }

    // Parse FORGE_STATUS from output
    const status = phases.parseCloudForgeStatus(result.output);

    // Record iteration
    state.recordIteration(wfState, currentPhase, status, result.tokensUsed);

    // After PLAN phase, read the plan to get sub-task count
    if (currentPhase === phases.PHASE_NAMES.PLAN && status?.result === 'DONE') {
      const planContent = state.loadPlan(args.workingDir);
      if (planContent) {
        const count = phases.parsePlanFile(planContent);
        wfState.totalSubTasks = count > 0 ? count : 1;
        wfState.currentSubTask = 0; // Will be incremented when TEST starts
      } else {
        tui.warnMessage('No .cloudforge/plan.md found - assuming 1 sub-task');
        wfState.totalSubTasks = 1;
        wfState.currentSubTask = 0;
      }
    }

    // Track retries and progress
    if (status?.result === 'NEEDS_RETRY') {
      ++phaseRetryCount;
      state.trackRetry(wfState, currentPhase, status?.summary);
    } else {
      phaseRetryCount = 0;
      if (status?.result === 'DONE')
        state.markPhaseCompleted(wfState, currentPhase);
    }

    // Save state after each iteration
    wfState.phase = currentPhase;
    state.saveState(args.workingDir, wfState);

    // Determine next phase
    const nextPhase = phases.getNextPhase(currentPhase, status, {
      subTaskNumber: wfState.currentSubTask,
      totalSubTasks: wfState.totalSubTasks,
      retryCount: phaseRetryCount,
      maxRetries: args.maxPhaseRetries,
    });

    // Show completed phases
    tui.completedPhasesList(wfState.completedPhases);

    // Transition
    if (!nextPhase) {
      // All done
      tui.finalSummary(wfState);
      break;
    }

    // If transitioning to a new phase (not retry), reset retry count
    if (nextPhase !== currentPhase)
      phaseRetryCount = 0;

    currentPhase = nextPhase;
    wfState.phase = currentPhase;
  }

  // Save final state
  state.saveState(args.workingDir, wfState);
  return 0;
}

main().then((code) => {
  process.exitCode = code || 0;
}).catch((err) => {
  tui.errorMessage(err.message);
  process.stderr.write(err.stack + '\n');
  process.exitCode = 1;
});
