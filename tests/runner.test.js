'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const runner = require('../lib/runner');

describe('runner', () => {
  describe('buildArgs', () => {
    it('builds basic args without session ID', () => {
      const args = runner.buildArgs('hello', { model: 'sonnet', maxTurns: 50 });
      assert.ok(args.includes('-p'));
      assert.ok(args.includes('--output-format'));
      assert.ok(args.includes('stream-json'));
      assert.ok(args.includes('--verbose'));
      assert.ok(args.includes('--dangerously-skip-permissions'));
      assert.ok(args.includes('--model'));
      assert.ok(args.includes('sonnet'));
      assert.ok(args.includes('hello'));
      assert.ok(!args.includes('--resume'));
    });

    it('includes --resume when session ID provided', () => {
      const args = runner.buildArgs('test', { sessionId: 'abc-123', model: 'opus', maxTurns: 30 });
      const resumeIdx = args.indexOf('--resume');
      assert.ok(resumeIdx >= 0);
      assert.equal(args[resumeIdx + 1], 'abc-123');
    });

    it('includes model parameter when specified', () => {
      const args = runner.buildArgs('test', { model: 'haiku' });
      const modelIdx = args.indexOf('--model');
      assert.equal(args[modelIdx + 1], 'haiku');
    });

    it('omits --model when not specified', () => {
      const args = runner.buildArgs('test', {});
      assert.ok(!args.includes('--model'));
    });

    it('omits --model when null', () => {
      const args = runner.buildArgs('test', { model: null });
      assert.ok(!args.includes('--model'));
    });

    it('includes max-turns parameter', () => {
      const args = runner.buildArgs('test', { maxTurns: 100 });
      const turnsIdx = args.indexOf('--max-turns');
      assert.equal(args[turnsIdx + 1], '100');
    });

    it('uses custom CLI path when provided', () => {
      const args = runner.buildArgs('test', { cliPath: '/custom/cli.js' });
      assert.equal(args[0], '/custom/cli.js');
    });

    it('uses default CLI path when not provided', () => {
      const args = runner.buildArgs('test', {});
      assert.equal(args[0], runner.DEFAULT_CLI_PATH);
    });

    it('prompt is the last argument', () => {
      const args = runner.buildArgs('my prompt', { model: 'sonnet' });
      assert.equal(args[args.length - 1], 'my prompt');
    });
  });

  describe('summarizeToolArgs', () => {
    it('extracts command from Bash tool', () => {
      assert.equal(runner.summarizeToolArgs('Bash', { command: 'npm test' }), 'npm test');
    });

    it('extracts file_path from Edit tool', () => {
      assert.equal(runner.summarizeToolArgs('Edit', { file_path: 'src/app.js' }), 'src/app.js');
    });

    it('extracts file_path from Write tool', () => {
      assert.equal(runner.summarizeToolArgs('Write', { file_path: 'new.js' }), 'new.js');
    });

    it('extracts file_path from Read tool', () => {
      assert.equal(runner.summarizeToolArgs('Read', { file_path: 'readme.md' }), 'readme.md');
    });

    it('extracts pattern from Glob tool', () => {
      assert.equal(runner.summarizeToolArgs('Glob', { pattern: '**/*.js' }), '**/*.js');
    });

    it('extracts pattern and path from Grep tool', () => {
      assert.equal(runner.summarizeToolArgs('Grep', { pattern: 'TODO', path: 'src/' }), 'TODO src/');
    });

    it('JSON-stringifies unknown tools', () => {
      const result = runner.summarizeToolArgs('CustomTool', { key: 'value' });
      assert.ok(result.includes('key'));
    });

    it('handles null input', () => {
      assert.equal(runner.summarizeToolArgs('Bash', null), '');
    });

    it('handles lowercase tool names', () => {
      assert.equal(runner.summarizeToolArgs('bash', { command: 'ls' }), 'ls');
      assert.equal(runner.summarizeToolArgs('edit', { file_path: 'f.js' }), 'f.js');
    });
  });

  describe('handleStreamEvent', () => {
    it('emits text from assistant message', () => {
      const emitted = [];
      const event = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello world' }] },
      };
      runner.handleStreamEvent(event, {}, (data) => emitted.push(data));
      assert.ok(emitted.some((e) => e.text === 'Hello world'));
    });

    it('emits text from content_block_delta', () => {
      const emitted = [];
      const event = { type: 'content_block_delta', delta: { text: 'chunk' } };
      runner.handleStreamEvent(event, {}, (data) => emitted.push(data));
      assert.ok(emitted.some((e) => e.text === 'chunk'));
    });

    it('emits tool call from assistant message', () => {
      const emitted = [];
      const event = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
          ],
        },
      };
      runner.handleStreamEvent(event, {}, (data) => emitted.push(data));
      assert.ok(emitted.some((e) => e.toolCall?.name === 'Bash'));
    });

    it('emits session ID from result event', () => {
      const emitted = [];
      const event = { type: 'result', session_id: 'sess-123' };
      runner.handleStreamEvent(event, {}, (data) => emitted.push(data));
      assert.ok(emitted.some((e) => e.sessionId === 'sess-123'));
    });

    it('emits tokens from result usage', () => {
      const emitted = [];
      const event = { type: 'result', usage: { input_tokens: 100, output_tokens: 50 } };
      runner.handleStreamEvent(event, {}, (data) => emitted.push(data));
      assert.ok(emitted.some((e) => e.tokens?.input === 100));
    });

    it('emits result text from result event', () => {
      const emitted = [];
      const event = { type: 'result', result: 'Final answer' };
      runner.handleStreamEvent(event, {}, (data) => emitted.push(data));
      assert.ok(emitted.some((e) => e.text === 'Final answer'));
    });

    it('handles null event gracefully', () => {
      const emitted = [];
      runner.handleStreamEvent(null, {}, (data) => emitted.push(data));
      assert.equal(emitted.length, 0);
    });

    it('handles non-object event gracefully', () => {
      const emitted = [];
      runner.handleStreamEvent('string', {}, (data) => emitted.push(data));
      assert.equal(emitted.length, 0);
    });

    it('handles event without matching type gracefully', () => {
      const emitted = [];
      runner.handleStreamEvent({ type: 'unknown' }, {}, (data) => emitted.push(data));
      assert.equal(emitted.length, 0);
    });
  });
});
