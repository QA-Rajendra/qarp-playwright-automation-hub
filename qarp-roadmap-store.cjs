'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROADMAP_FILE = path.join(__dirname, 'data', 'qa-roadmap.json');
const LEVEL_STATUSES = new Set(['not-started', 'in-progress', 'complete']);
const ITEM_STATUSES = new Set(['not-started', 'in-progress', 'blocked', 'complete']);

function validationError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function cleanText(value, label, maxLength, required = false) {
  if (typeof value !== 'string') {
    if (required) throw validationError(`${label} must be text.`);
    return '';
  }
  const cleaned = value.trim();
  if (required && !cleaned) throw validationError(`${label} is required.`);
  if (cleaned.length > maxLength) {
    throw validationError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return cleaned;
}

function validateRoadmap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
    throw validationError('Roadmap must be a version 1 JSON object.');
  }
  const title = cleanText(value.title, 'Roadmap title', 120, true);
  if (!Array.isArray(value.levels) || value.levels.length !== 9) {
    throw validationError('Roadmap must contain exactly nine levels (Level 0 through Level 8).');
  }

  const ids = new Set();
  const levels = value.levels.map((level, index) => {
    if (!level || typeof level !== 'object' || Array.isArray(level)) {
      throw validationError(`Level ${index} must be an object.`);
    }
    if (level.id !== `level-${index}`) {
      throw validationError(`Expected level-${index} at roadmap position ${index}.`);
    }
    const levelTitle = cleanText(level.title, `Level ${index} title`, 120, true);
    const description = cleanText(level.description, `Level ${index} description`, 800);
    const status = level.status || 'not-started';
    if (!LEVEL_STATUSES.has(status)) {
      throw validationError(`Level ${index} has an unsupported status.`);
    }
    if (!Array.isArray(level.items) || level.items.length > 200) {
      throw validationError(`Level ${index} must have an item list of at most 200 entries.`);
    }

    const items = level.items.map((item, itemIndex) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw validationError(`Level ${index}, item ${itemIndex + 1} must be an object.`);
      }
      const id = cleanText(item.id, 'Item ID', 80, true);
      if (ids.has(id)) throw validationError(`Duplicate roadmap item ID: ${id}.`);
      ids.add(id);
      const itemStatus = item.status || 'not-started';
      if (!ITEM_STATUSES.has(itemStatus)) {
        throw validationError(`Item "${id}" has an unsupported status.`);
      }
      const targetDate = cleanText(item.targetDate, 'Target date', 10);
      if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        throw validationError(`Item "${id}" target date must use YYYY-MM-DD.`);
      }
      return {
        id,
        title: cleanText(item.title, 'Item title', 160, true),
        description: cleanText(item.description, 'Item description', 1000),
        status: itemStatus,
        owner: cleanText(item.owner, 'Owner', 80),
        targetDate
      };
    });

    return {
      id: level.id,
      title: levelTitle,
      description,
      status,
      items
    };
  });

  return { version: 1, title, levels };
}

function readRoadmap(filePath = ROADMAP_FILE) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read the QA roadmap JSON file: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`QA roadmap JSON is invalid: ${error.message}`);
  }
  return validateRoadmap(parsed);
}

function writeRoadmap(value, filePath = ROADMAP_FILE) {
  const roadmap = validateRoadmap(value);
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(roadmap, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        error.message = `${error.message}; temporary roadmap cleanup failed: ${cleanupError.message}`;
      }
    }
    throw error;
  }
  return roadmap;
}

module.exports = { readRoadmap, validateRoadmap, writeRoadmap };
