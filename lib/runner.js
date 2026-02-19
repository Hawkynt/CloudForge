'use strict';

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const tui = require('./tui');

const DEFAULT_CLI_PATH = path.join('X:', 'Coding', 'Interpreters', 'Node.JS v22.17.1',
  'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');

function buildArgs(prompt, options) {
  const args = [
    options.cliPath || DEFAULT_CLI_PATH,
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
    '--max-turns', String(options.maxTurns || 50),
  ];

  if (options.model)
    args.push('--model', options.model);

  if (options.sessionId)
    args.push('--resume', options.sessionId);

  args.push(prompt);
  return args;
}

function runAgent(prompt, options = {}) {
  return new Promise((resolve) => {
    const args = buildArgs(prompt, options);
    const cwd = options.workingDir || process.cwd();
    const env = { ...process.env };
    const verbose = options.verbose || false;

    if (verbose) {
      tui.debug(`[spawn] node ${args.join(' ')}`);
      tui.debug(`[cwd] ${cwd}`);
      tui.debug(`[pid] spawning...`);
    }

    const proc = spawn('node', args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (verbose)
      tui.debug(`[pid] ${proc.pid}`);

    let stderrBuf = '';
    let fullOutput = '';
    let sessionId = options.sessionId || null;
    let tokensUsed = { input: 0, output: 0 };
    let lastResultText = '';
    let lineCount = 0;

    // Parse stdout line-by-line as stream-json
    const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      ++lineCount;

      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        // Non-JSON line - display as raw output
        if (trimmed.length > 0) {
          if (verbose)
            tui.debug(`[stdout:raw] ${trimmed.slice(0, 200)}`);
          tui.streamText(trimmed + '\n');
          fullOutput += trimmed + '\n';
        }
        return;
      }

      if (verbose)
        tui.debug(`[event] type=${event.type || 'unknown'} ${event.subtype ? 'subtype=' + event.subtype : ''}`);

      handleStreamEvent(event, options, (data) => {
        if (data.text) {
          tui.streamText(data.text);
          fullOutput += data.text;
          lastResultText += data.text;
        }
        if (data.toolCall)
          tui.toolCallLine(data.toolCall.name, data.toolCall.args);
        if (data.sessionId) {
          sessionId = data.sessionId;
          if (verbose)
            tui.debug(`[session] ${sessionId}`);
        }
        if (data.tokens) {
          tokensUsed.input += data.tokens.input || 0;
          tokensUsed.output += data.tokens.output || 0;
        }
      });
    });

    // Always stream stderr in real-time - this is where crash info lives
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;
      // Always show stderr lines - they contain errors, crash info, rate limit messages
      const trimmed = text.trim();
      if (trimmed)
        tui.stderrLine(trimmed);
    });

    proc.on('close', (exitCode) => {
      rl.close();
      if (verbose)
        tui.debug(`[exit] code=${exitCode} lines=${lineCount} output=${fullOutput.length}chars`);

      // Always surface failures clearly
      if (exitCode !== 0 && lineCount === 0)
        tui.errorMessage(`Agent process exited with code ${exitCode} and produced no output.${stderrBuf ? '\n  stderr: ' + stderrBuf.trim().slice(0, 500) : ''}`);

      resolve({
        success: exitCode === 0,
        exitCode,
        output: fullOutput,
        resultText: lastResultText,
        sessionId,
        tokensUsed,
        stderr: stderrBuf,
      });
    });

    proc.on('error', (err) => {
      tui.errorMessage(`Failed to spawn Agent process: ${err.message}`);
      resolve({
        success: false,
        exitCode: -1,
        output: fullOutput,
        resultText: '',
        sessionId,
        tokensUsed,
        stderr: err.message,
      });
    });

    // Store proc reference for external kill
    if (options.onProcess)
      options.onProcess(proc);
  });
}

function handleStreamEvent(event, options, emit) {
  if (!event || typeof event !== 'object') return;

  // Assistant message text
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text)
        emit({ text: block.text });
    }
  }

  // Content block delta (streaming tokens)
  if (event.type === 'content_block_delta' && event.delta?.text)
    emit({ text: event.delta.text });

  // Tool use events
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    for (const block of event.message.content) {
      if (block.type === 'tool_use') {
        const name = block.name || 'unknown';
        const args = summarizeToolArgs(name, block.input);
        emit({ toolCall: { name, args } });
      }
    }
  }

  // Result event with session info
  if (event.type === 'result') {
    if (event.session_id)
      emit({ sessionId: event.session_id });
    if (event.result)
      emit({ text: event.result });
    if (event.usage)
      emit({ tokens: { input: event.usage.input_tokens || 0, output: event.usage.output_tokens || 0 } });
    if (event.total_usage)
      emit({ tokens: { input: event.total_usage.input_tokens || 0, output: event.total_usage.output_tokens || 0 } });
  }

  // Message start/stop with usage
  if (event.type === 'message' && event.usage)
    emit({ tokens: { input: event.usage.input_tokens || 0, output: event.usage.output_tokens || 0 } });
}

function summarizeToolArgs(name, input) {
  if (!input) return '';
  switch (name) {
    case 'Bash':
    case 'bash':
      return input.command || '';
    case 'Edit':
    case 'edit':
      return input.file_path || '';
    case 'Write':
    case 'write':
      return input.file_path || '';
    case 'Read':
    case 'read':
      return input.file_path || '';
    case 'Glob':
    case 'glob':
      return input.pattern || '';
    case 'Grep':
    case 'grep':
      return `${input.pattern || ''} ${input.path || ''}`.trim();
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}

module.exports = {
  runAgent,
  buildArgs,
  handleStreamEvent,
  summarizeToolArgs,
  DEFAULT_CLI_PATH,
};
