'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parsePorcelainStatus } = require('../../qarp-git-status.cjs');

test('parses staged, unstaged, and untracked paths including spaces and Unicode', () => {
  const parsed = parsePorcelainStatus([
    'M  staged file.js\0',
    ' M work in progress.js\0',
    '?? screenshots/écran.png\0'
  ].join(''));

  assert.deepEqual(parsed.staged, [
    { path: 'staged file.js', type: 'modified', status: 'M ' }
  ]);
  assert.deepEqual(parsed.unstaged, [
    { path: 'work in progress.js', type: 'modified', status: ' M' }
  ]);
  assert.deepEqual(parsed.untracked, [
    { path: 'screenshots/écran.png', type: 'added', status: '??' }
  ]);
  assert.equal(parsed.totalFiles, 3);
  assert.equal(parsed.truncated, false);
});

test('reports the same path in both staged and unstaged groups when partially staged', () => {
  const parsed = parsePorcelainStatus('MM src/app.js\0');

  assert.equal(parsed.staged[0].path, 'src/app.js');
  assert.equal(parsed.unstaged[0].path, 'src/app.js');
  assert.equal(parsed.staged[0].status, 'MM');
});

test('uses the destination path for renamed files and skips the source path record', () => {
  const parsed = parsePorcelainStatus('R  new name.js\0old name.js\0');

  assert.deepEqual(parsed.staged, [
    { path: 'new name.js', type: 'renamed', status: 'R ' }
  ]);
  assert.equal(parsed.totalFiles, 1);
});

test('classifies deleted and conflicted files', () => {
  const parsed = parsePorcelainStatus(' D removed.js\0UU conflicted.js\0');

  assert.equal(parsed.unstaged[0].type, 'deleted');
  assert.equal(parsed.unstaged[1].type, 'conflicted');
});

test('limits returned file records and marks the result truncated', () => {
  const parsed = parsePorcelainStatus(' M one.js\0 M two.js\0 M three.js\0', 2);

  assert.equal(parsed.unstaged.length, 2);
  assert.equal(parsed.totalFiles, 3);
  assert.equal(parsed.truncated, true);
});

test('returns empty groups for a clean worktree', () => {
  const parsed = parsePorcelainStatus('');

  assert.deepEqual(parsed.staged, []);
  assert.deepEqual(parsed.unstaged, []);
  assert.deepEqual(parsed.untracked, []);
  assert.equal(parsed.truncated, false);
});
