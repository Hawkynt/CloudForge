'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { synthesizeStatus } = require('../forge');

describe('synthesizeStatus', () => {
  it('returns synthetic NEEDS_RETRY when agent exited non-zero with no status', () => {
    const result = synthesizeStatus({ status: null, success: false }, 'VERIFY');
    assert.equal(result.result, 'NEEDS_RETRY');
    assert.equal(result.phase, 'VERIFY');
    assert.equal(result.tasksRemaining, null);
    assert.ok(result.summary.includes('crashed'));
  });

  it('returns synthetic NEEDS_RETRY when agent exited zero with no status', () => {
    const result = synthesizeStatus({ status: null, success: true }, 'IMPLEMENT');
    assert.equal(result.result, 'NEEDS_RETRY');
    assert.equal(result.phase, 'IMPLEMENT');
    assert.equal(result.tasksRemaining, null);
    assert.ok(result.summary.includes('without CLOUDFORGE_STATUS'));
  });

  it('returns original status when agent exited non-zero but had valid status', () => {
    const original = { phase: 'TEST', result: 'DONE', tasksRemaining: 3, summary: 'Tests passed' };
    const result = synthesizeStatus({ status: original, success: false }, 'TEST');
    assert.deepEqual(result, original);
  });

  it('returns original status when agent exited zero with valid status', () => {
    const original = { phase: 'REVIEW', result: 'NEEDS_RETRY', tasksRemaining: 0, summary: 'Issues found' };
    const result = synthesizeStatus({ status: original, success: true }, 'REVIEW');
    assert.deepEqual(result, original);
  });
});
