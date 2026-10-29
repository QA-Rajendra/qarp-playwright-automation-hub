'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readRoadmap, validateRoadmap, writeRoadmap } = require('../../qarp-roadmap-store.cjs');

function validRoadmap() {
  return {
    version: 1,
    title: 'Test roadmap',
    levels: Array.from({ length: 9 }, (_, index) => ({
      id: `level-${index}`,
      title: `Level ${index}`,
      description: '',
      status: 'not-started',
      items: []
    }))
  };
}

test('validates the fixed nine-level structure and normalized action fields', () => {
  const roadmap = validRoadmap();
  roadmap.levels[0].items.push({
    id: 'check-1',
    title: '  Run a smoke test  ',
    description: '  ',
    status: 'complete',
    owner: ' QA ',
    targetDate: '2026-10-30'
  });

  const normalized = validateRoadmap(roadmap);
  assert.equal(normalized.levels[0].items[0].title, 'Run a smoke test');
  assert.equal(normalized.levels[0].items[0].description, '');
  assert.equal(normalized.levels[0].items[0].owner, 'QA');
  assert.throws(() => validateRoadmap({ ...roadmap, levels: [] }), /exactly nine levels/);
});

test('rejects duplicate item ids, invalid status values, and malformed target dates', () => {
  const roadmap = validRoadmap();
  roadmap.levels[0].items.push({ id: 'duplicate', title: 'One' });
  roadmap.levels[1].items.push({ id: 'duplicate', title: 'Two' });
  assert.throws(() => validateRoadmap(roadmap), /Duplicate roadmap item ID/);

  const invalidStatus = validRoadmap();
  invalidStatus.levels[0].status = 'unknown';
  assert.throws(() => validateRoadmap(invalidStatus), /unsupported status/);

  const invalidDate = validRoadmap();
  invalidDate.levels[0].items.push({ id: 'date', title: 'Date', targetDate: '30/10/2026' });
  assert.throws(() => validateRoadmap(invalidDate), /YYYY-MM-DD/);
});

test('writes and reads a JSON roadmap using the requested file path', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qarp-roadmap-'));
  const filePath = path.join(directory, 'qa-roadmap.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const roadmap = validRoadmap();
  roadmap.levels[3].items.push({
    id: 'owner-action',
    title: 'Assign an owner',
    description: '',
    status: 'in-progress',
    owner: 'QARP',
    targetDate: ''
  });
  writeRoadmap(roadmap, filePath);

  assert.deepEqual(readRoadmap(filePath), roadmap);
  assert.deepEqual(fs.readdirSync(directory), ['qa-roadmap.json']);
});
