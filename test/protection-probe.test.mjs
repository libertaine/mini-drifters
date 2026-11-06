// Temporary: fails on purpose to prove that a failing `test` check blocks a merge.
// This pull request is closed without merging.
import test from 'node:test';
import assert from 'node:assert/strict';

test('protection probe fails on purpose', () => {
  assert.fail('deliberate failure');
});
