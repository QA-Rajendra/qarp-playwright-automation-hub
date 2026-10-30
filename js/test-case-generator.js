'use strict';

(function exposeTestCaseGenerator(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QarpTestCaseGenerator = api;
})(typeof globalThis === 'object' ? globalThis : this, function createTestCaseGenerator() {
  const STORAGE_KEY = 'qarp-test-case-generator-v1';
  const MAX_CASES = 200;
  const MAX_CONTROL_CASES = 5_000;
  const MAX_CONTROL_FIELDS = 500;
  const MAX_CONDITIONS = 500;
  const MAX_CONDITION_RULES = 50;
  const MAX_STORAGE_CHARS = 2_000_000;
  const CASE_FIELDS = ['title', 'preconditions', 'steps', 'expectedResult', 'priority', 'type'];
  const TEST_TYPES = [
    'Positive',
    'Boundary',
    'Negative',
    'Equivalence Partitioning',
    'Decision Table',
    'State Transition',
    'Error Guessing',
    'Use Case'
  ];
  const CONTROL_CATEGORIES = ['Text', 'Number', 'Choice', 'Date & time', 'File', 'Button', 'Toggle', 'Other'];

  function createControl(name, type, category, values = {}) {
    return {
      id: values.id || `field-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(name || '').trim(),
      type: String(type || 'text'),
      category: String(category || 'Text'),
      required: Boolean(values.required),
      min: String(values.min == null ? '' : values.min),
      max: String(values.max == null ? '' : values.max),
      options: String(values.options || ''),
      errorRequired: String(values.errorRequired || ''),
      errorInvalid: String(values.errorInvalid || ''),
      fileTypes: String(values.fileTypes || ''),
      maxFileSize: String(values.maxFileSize || '')
    };
  }

  function normalizeControl(field, index = 0) {
    if (!field || typeof field !== 'object') throw new TypeError(`Control ${index + 1} must be an object.`);
    const name = String(field.name || '').trim();
    if (!name) throw new Error(`Control ${index + 1} needs a name.`);
    if (name.length > 120) throw new Error(`Control "${name.slice(0, 30)}" has a name longer than 120 characters.`);
    const type = String(field.type || 'text').toLowerCase();
    const validTypes = new Set(['text', 'email', 'password', 'number', 'tel', 'url', 'search', 'textarea', 'select', 'radio', 'checkbox', 'date', 'time', 'datetime-local', 'file', 'button', 'submit', 'hidden']);
    if (!validTypes.has(type)) throw new Error(`Control "${name}" has unsupported type "${type}".`);
    const min = String(field.min == null ? '' : field.min).trim();
    const max = String(field.max == null ? '' : field.max).trim();
    if (['number', 'text', 'email', 'password', 'textarea', 'tel', 'url', 'search'].includes(type)) {
      for (const [label, value] of [['minimum', min], ['maximum', max]]) {
        if (value && !Number.isFinite(Number(value))) throw new Error(`Control "${name}" has a non-numeric ${label} rule.`);
        if (value && type !== 'number' && (!Number.isInteger(Number(value)) || Number(value) < 0)) {
          throw new Error(`Control "${name}" ${label} length must be a non-negative whole number.`);
        }
      }
      if (min && max && Number(min) > Number(max)) {
        throw new Error(`Control "${name}" must have a minimum not greater than its maximum.`);
      }
    }
    if (['select', 'radio'].includes(type) && !parseMatrixValues(String(field.options || '')).length) {
      throw new Error(`Control "${name}" needs at least one dropdown/radio option.`);
    }
    const fileTypes = String(field.fileTypes || '').trim();
    if (type === 'file' && fileTypes && parseMatrixValues(fileTypes).some(extension => !/^\.[a-z0-9]{1,12}$/i.test(extension))) {
      throw new Error(`Control "${name}" file types must be extensions such as .pdf or .png.`);
    }
    const maxFileSize = String(field.maxFileSize || '').trim();
    if (type === 'file' && maxFileSize && !/^\d+(?:\.\d+)?\s*(?:B|KB|MB|GB)?$/i.test(maxFileSize)) {
      throw new Error(`Control "${name}" has an invalid maximum file size.`);
    }
    return {
      ...createControl(name, type, field.category || 'Text', field),
      id: String(field.id || `field-${index + 1}`),
      min,
      max,
      options: String(field.options || '')
    };
  }

  function validateConditions(conditions, fields) {
    if (!Array.isArray(conditions)) throw new TypeError('Conditions must be a list.');
    if (conditions.length > MAX_CONDITIONS) throw new Error(`A screen can have at most ${MAX_CONDITIONS} conditions.`);
    const fieldIds = new Set(fields.map(field => field.id));
    const validOperators = new Set(['is empty', 'is not empty', 'equals', 'does not equal', 'contains', 'is checked', 'is unchecked']);
    const validActions = new Set(['Show', 'Hide', 'Enable', 'Disable', 'Require']);
    const validApplyStages = new Set(['On page load', 'On field change', 'On button click', 'On submit']);
    return conditions.map((condition, index) => {
      if (!condition || !Array.isArray(condition.rules) || condition.rules.length === 0) {
        throw new Error(`Condition ${index + 1} needs at least one IF rule.`);
      }
      if (condition.rules.length > MAX_CONDITION_RULES) {
        throw new Error(`Condition ${index + 1} can have at most ${MAX_CONDITION_RULES} IF rules.`);
      }
      condition.rules.forEach((rule, ruleIndex) => {
        if (!fieldIds.has(rule.fieldId)) throw new Error(`Condition ${index + 1}, rule ${ruleIndex + 1} references a missing field.`);
        if (!validOperators.has(rule.operator)) throw new Error(`Condition ${index + 1} has an unsupported operator.`);
        if (!['AND', 'OR'].includes(rule.join || 'AND')) throw new Error(`Condition ${index + 1} has an invalid AND/OR join.`);
      });
      if (condition.apply && !validApplyStages.has(condition.apply)) {
        throw new Error(`Condition ${index + 1} has an unsupported apply timing.`);
      }
      if (!validActions.has(condition.thenAction) || !fieldIds.has(condition.thenTarget)
          || !['No change', ...validActions].includes(condition.elseAction || 'No change')
          || !fieldIds.has(condition.elseTarget || condition.thenTarget)) {
        throw new Error(`Condition ${index + 1} needs a valid THEN action and target field.`);
      }
      return {
        id: String(condition.id || `condition-${index + 1}`),
        rules: condition.rules.map(rule => ({
          fieldId: String(rule.fieldId),
          operator: rule.operator,
          value: String(rule.value || ''),
          join: rule.join === 'OR' ? 'OR' : 'AND'
        })),
        thenAction: condition.thenAction,
        thenTarget: String(condition.thenTarget),
        apply: condition.apply === 'On page load' || condition.apply === 'On button click'
          ? condition.apply
          : condition.apply === 'On submit' ? 'On button click' : 'On field change',
        elseAction: condition.elseAction || 'No change',
        elseTarget: String(condition.elseTarget || condition.thenTarget)
      };
    });
  }

  function normalizeControls(fields) {
    if (!Array.isArray(fields)) throw new TypeError('Screen controls must be a list.');
    if (fields.length > MAX_CONTROL_FIELDS) throw new Error(`A screen can contain at most ${MAX_CONTROL_FIELDS} controls.`);
    const normalized = fields.map(normalizeControl);
    const names = new Set();
    const ids = new Set();
    normalized.forEach(field => {
      const name = field.name.toLowerCase();
      if (names.has(name)) throw new Error(`Control name "${field.name}" is duplicated.`);
      if (ids.has(field.id)) throw new Error(`Control ID "${field.id}" is duplicated.`);
      names.add(name);
      ids.add(field.id);
    });
    return normalized;
  }

  function generateFieldTestCases(fields, conditions = []) {
    const normalized = normalizeControls(fields);
    if (!normalized.length) throw new Error('Add at least one control before generating test cases.');
    const normalizedConditions = validateConditions(conditions, normalized);
    if (normalized.length * TEST_TYPES.length + normalizedConditions.length * 2 > MAX_CONTROL_CASES) {
      throw new Error(`Generated cases exceed the ${MAX_CONTROL_CASES}-case safety limit.`);
    }
    const cases = [];
    normalized.forEach((field, fieldIndex) => {
      const min = field.min === '' ? null : Number(field.min);
      const max = field.max === '' ? null : Number(field.max);
      const optionValues = parseMatrixValues(field.options);
      const validValue = field.type === 'checkbox'
        ? 'checked'
        : field.type === 'radio' ? optionValues[0] || 'valid option'
        : field.type === 'select' ? optionValues[0] || 'valid option'
          : field.type === 'file' ? `valid-file${parseMatrixValues(field.fileTypes)[0] || '.pdf'}`
          : field.type === 'number' ? (min !== null ? String(min) : '1')
            : field.type === 'email' ? 'qa@example.test' : 'valid input';
      const invalidValue = field.type === 'email' ? 'not-an-email'
        : field.type === 'number' ? 'not-a-number'
          : field.type === 'file' ? 'unsupported.exe' : 'invalid input';
      const minBoundary = min === null ? 'below minimum / minimum' : `${min - 1} / ${min}`;
      const maxBoundary = max === null ? 'maximum / above maximum' : `${max} / ${max + 1}`;
      const scenarioFor = (testType) => ({
        Positive: 'Valid value',
        Negative: `Invalid value${field.required ? ' / required field' : ''}`,
        Boundary: min !== null ? `${field.type === 'number' ? 'Min value' : 'Min length'} (${min})`
          : max !== null ? `${field.type === 'number' ? 'Max value' : 'Max length'} (${max})` : 'Boundary values',
        'Equivalence Partitioning': 'Valid and invalid partitions',
        'Decision Table': `${field.required ? 'Required' : 'Optional'} field decision`,
        'State Transition': 'Empty → valid → cleared',
        'Use Case': 'Complete field user flow',
        'Error Guessing': 'Malformed, whitespace, and long input'
      })[testType];
      const conditionFor = (testType) => ({
        Positive: 'IF valid value THEN Accepted ELSE show the error message',
        Negative: `IF invalid value THEN ${field.errorInvalid || 'Show the error message'} ELSE accept and continue`,
        Boundary: min !== null
          ? `IF below minimum (${min}) THEN ${field.errorInvalid || 'Show the error message'} ELSE accept and continue`
          : max !== null
            ? `IF above maximum (${max}) THEN ${field.errorInvalid || 'Show the error message'} ELSE accept and continue`
            : 'IF outside configured boundary THEN show the error message ELSE accept and continue',
        'Equivalence Partitioning': 'IF value is in a valid partition THEN Accepted ELSE show the error message',
        'Decision Table': `IF ${field.required ? 'required value is present' : 'value is supplied'} THEN continue ELSE ${field.errorRequired || 'show the error message'}`,
        'State Transition': 'IF value changes empty → valid → cleared THEN update validation state ELSE preserve current state',
        'Use Case': 'IF user completes the flow THEN show the next screen ELSE show validation feedback',
        'Error Guessing': 'IF malformed, whitespace, or oversized input THEN reject with validation ELSE continue'
      })[testType];
      const boundaryInput = field.type === 'file'
        ? `${validValue}; ${field.maxFileSize ? `${field.maxFileSize} / above ${field.maxFileSize}` : 'maximum / oversized'}`
        : ['select', 'radio'].includes(field.type)
          ? `${optionValues[0] || 'first option'} / ${optionValues.at(-1) || 'last option'} / unsupported option`
          : `${minBoundary}; ${maxBoundary}`;
      const examples = {
        Positive: { value: validValue, expected: 'Accepted' },
        Negative: {
          value: `${field.required ? 'empty; ' : ''}${invalidValue}`,
          expected: `${field.required ? field.errorRequired || 'Show the required-field validation message.' : 'Reject the invalid value.'} ${field.errorInvalid || 'Show the invalid-value validation message.'}`
        },
        Boundary: {
          value: boundaryInput,
          expected: field.errorInvalid || 'Accepted at the configured boundary; show validation outside the boundary.'
        },
        'Equivalence Partitioning': { value: `${validValue} / ${invalidValue}`, expected: 'Verify one representative valid and invalid value from each equivalence class.' },
        'Decision Table': { value: `${field.required ? 'required' : 'optional'} × ${validValue}`, expected: 'Verify the expected outcome for each relevant combination of field and form conditions.' },
        'State Transition': { value: 'empty → valid → cleared', expected: 'Verify field state and validation messages update after each transition.' },
        'Use Case': { value: validValue, expected: 'Complete the user flow using this field and verify the resulting screen/action.' },
        'Error Guessing': { value: `${invalidValue}; whitespace; very long input`, expected: 'Check likely edge cases, malformed values, whitespace, and length limits.' }
      };
      TEST_TYPES.forEach((testType, typeIndex) => {
        const sample = examples[testType];
        cases.push({
          id: `TC${String(cases.length + 1).padStart(3, '0')}`,
          fieldId: field.id,
          fieldName: field.name,
          fieldType: field.type,
          testType,
          title: scenarioFor(testType),
          input: sample.value,
          expectedResult: sample.expected,
          condition: conditionFor(testType),
          priority: testType === 'Negative' || testType === 'Boundary' ? 'High' : 'Medium',
          order: fieldIndex * TEST_TYPES.length + typeIndex
        });
      });
    });

    normalizedConditions.forEach((condition, index) => {
      const target = normalized.find(field => field.id === condition.thenTarget);
      const expression = condition.rules.map((rule, ruleIndex) =>
        `${ruleIndex ? rule.join : 'IF'} ${normalized.find(field => field.id === rule.fieldId).name} ${rule.operator}${rule.value ? ` "${rule.value}"` : ''}`
      ).join(' ');
      const elseTarget = normalized.find(field => field.id === condition.elseTarget);
      const branches = [
        {
          suffix: 'TRUE',
          expectedResult: `When the IF condition is true, ${condition.thenAction.toLowerCase()} ${target.name} ${condition.apply.toLowerCase()}.`
        },
        {
          suffix: 'ELSE',
          expectedResult: condition.elseAction === 'No change'
            ? `When the IF condition is false, leave ${elseTarget.name} unchanged.`
            : `When the IF condition is false, ${condition.elseAction.toLowerCase()} ${elseTarget.name} ${condition.apply.toLowerCase()}.`
        }
      ];
      branches.forEach(branch => cases.push({
        id: `TC${String(cases.length + 1).padStart(3, '0')}`,
        fieldId: target.id,
        fieldName: target.name,
        fieldType: target.type,
        testType: 'Condition',
        title: `Condition ${index + 1} — ${branch.suffix}: ${target.name}`,
        input: expression,
        expectedResult: branch.expectedResult,
        condition: `${expression} THEN ${condition.thenAction} ${target.name} ELSE ${condition.elseAction === 'No change' ? `leave ${elseTarget.name} unchanged` : `${condition.elseAction} ${elseTarget.name}`}`,
        priority: 'Medium',
        order: cases.length
      }));
    });
    return cases;
  }

  function generateDecisionTableMatrix(fields, maxCases = MAX_CONTROL_CASES) {
    const normalized = normalizeControls(fields).filter(field => !['button', 'submit', 'hidden'].includes(field.type));
    if (!normalized.length) throw new Error('Add at least one input control before generating the decision table matrix.');
    const limit = Math.max(0, Math.min(MAX_CONTROL_CASES, Number(maxCases) || 0));
    let total = 1;
    for (let index = 0; index < normalized.length; index += 1) {
      total *= 3;
      if (total > limit) {
        throw new Error(`The decision table matrix requires ${total} or more combinations, exceeding the ${limit}-case limit. Reduce the number of input controls.`);
      }
    }

    const button = fields.find(field => ['button', 'submit'].includes(String(field.type).toLowerCase()));
    const cases = [];
    const states = ['Valid', 'Invalid', 'Empty'];
    function build(index, combination) {
      if (index < 0) {
        const values = normalized.map(field => {
          const state = combination[field.id];
          if (state === 'Valid') return `${field.name}: ${getValidControlValue(field)}`;
          if (state === 'Empty') return `${field.name}: Empty`;
          return `${field.name}: ${getInvalidControlValue(field)}`;
        });
        const errors = normalized.flatMap(field => {
          const state = combination[field.id];
          if (state === 'Invalid') return [`${field.name}: ${field.errorInvalid || 'invalid value'}`];
          if (state === 'Empty' && field.required) return [`${field.name}: ${field.errorRequired || 'is required'}`];
          return [];
        });
        const valid = errors.length === 0;
        const condition = valid
          ? 'IF all fields valid THEN form submits successfully'
          : `IF form is invalid THEN show ${errors.join('; ')} and do not submit`;
        cases.push({
          id: `M${String(cases.length + 1).padStart(3, '0')}`,
          fieldId: 'form',
          fieldName: 'Whole form',
          fieldType: 'Form',
          testType: 'Decision Table Matrix',
          title: valid ? 'All fields valid' : 'Invalid / empty field combination',
          input: values.join(', '),
          expectedResult: valid
            ? 'Form submits successfully'
            : `Do not submit; show ${errors.join('; ')}`,
          condition: button
            ? `${condition} (${button.name})`
            : condition,
          matrixValues: { ...combination },
          priority: valid ? 'Medium' : 'High',
          order: cases.length
        });
        return;
      }
      const field = normalized[index];
      states.forEach(state => {
        combination[field.id] = state;
        build(index - 1, combination);
      });
      delete combination[field.id];
    }
    build(normalized.length - 1, {});
    return cases;
  }

  function getValidControlValue(field) {
    const options = parseMatrixValues(field.options);
    if (field.type === 'checkbox') return 'Checked';
    if (field.type === 'select' || field.type === 'radio') return options[0] || 'valid option';
    if (field.type === 'number') return field.min || '1';
    if (field.type === 'email') return 'qa@example.test';
    if (field.type === 'file') return `valid file ${parseMatrixValues(field.fileTypes)[0] || '.pdf'}`;
    if (field.type === 'date') return 'valid date';
    return 'Valid value';
  }

  function getInvalidControlValue(field) {
    if (field.type === 'checkbox') return 'Invalid checkbox state';
    if (field.type === 'email') return 'not-an-email';
    if (field.type === 'number') return 'not-a-number';
    if (field.type === 'file') return 'unsupported.exe';
    const min = field.min === '' ? null : Number(field.min);
    if (min !== null && min > 0) return `below minimum (${min - 1})`;
    const max = field.max === '' ? null : Number(field.max);
    if (max !== null) return `above maximum (${max + 1})`;
    return 'Invalid value';
  }

  function evaluateCondition(condition, values) {
    const results = condition.rules.map(rule => {
      const value = values[rule.fieldId];
      switch (rule.operator) {
        case 'is empty': return value == null || String(value).trim() === '';
        case 'is not empty': return value != null && String(value).trim() !== '';
        case 'equals': return String(value == null ? '' : value) === rule.value;
        case 'does not equal': return String(value == null ? '' : value) !== rule.value;
        case 'contains': return String(value == null ? '' : value).includes(rule.value);
        case 'is checked': return value === true || value === 'true' || value === 'checked';
        case 'is unchecked': return !(value === true || value === 'true' || value === 'checked');
        default: return false;
      }
    });
    return results.slice(1).reduce((result, value, index) =>
      condition.rules[index + 1].join === 'OR' ? result || value : result && value, results[0]);
  }

  function parseMatrixValues(rawValue) {
    if (typeof rawValue !== 'string') return [];
    const seen = new Set();
    return rawValue.split(/[,\r\n]+/)
      .map(value => value.trim())
      .filter(value => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  }

  function normalizeMatrix(matrix) {
    if (!Array.isArray(matrix)) throw new TypeError('Matrix data must be a list of columns.');
    const names = new Set();
    return matrix.map((column, index) => {
      const name = String(column && column.name || '').trim();
      const key = name.toLowerCase();
      if (!name) throw new Error(`Matrix column ${index + 1} needs a name.`);
      if (names.has(key)) throw new Error(`Matrix column "${name}" is duplicated.`);
      names.add(key);
      const values = Array.isArray(column.values)
        ? parseMatrixValues(column.values.join('\n'))
        : parseMatrixValues(String(column.values || ''));
      if (!values.length) throw new Error(`Matrix column "${name}" needs at least one value.`);
      return { name, values };
    });
  }

  function estimateCombinations(matrix) {
    const columns = normalizeMatrix(matrix);
    return columns.reduce((total, column) => total * column.values.length, 1);
  }

  function interpolate(template, combination) {
    return String(template || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, key) =>
      Object.prototype.hasOwnProperty.call(combination, key) ? combination[key] : token
    );
  }

  function generateCases(template, matrix, options = {}) {
    const columns = normalizeMatrix(matrix);
    const total = columns.reduce((count, column) => count * column.values.length, 1);
    const limit = options.limit === undefined ? MAX_CASES : Math.max(1, Math.min(MAX_CASES, Number(options.limit) || MAX_CASES));
    if (total > limit && options.confirmTruncate !== true) {
      const error = new Error(`This matrix creates ${total} cases. Confirm generation of the first ${limit}.`);
      error.code = 'MATRIX_LIMIT_CONFIRMATION_REQUIRED';
      error.total = total;
      error.limit = limit;
      throw error;
    }

    const combinations = [];
    function build(index, combination) {
      if (combinations.length >= limit) return;
      if (index >= columns.length) {
        combinations.push({ ...combination });
        return;
      }
      const column = columns[index];
      for (const value of column.values) {
        combination[column.name] = value;
        build(index + 1, combination);
        if (combinations.length >= limit) break;
      }
      delete combination[column.name];
    }
    build(0, {});

    const source = template && typeof template === 'object' ? template : {};
    const values = { feature: source.feature || 'feature', ...combinations[0] };
    const cases = combinations.map((combination, index) => ({
      id: `TC-${String(index + 1).padStart(3, '0')}`,
      title: interpolate(source.title || 'Verify {{feature}}', { feature: source.feature || 'feature', ...combination }),
      preconditions: interpolate(source.preconditions, { ...values, ...combination }),
      steps: interpolate(source.steps, { ...values, ...combination }),
      expectedResult: interpolate(source.expectedResult, { ...values, ...combination }),
      priority: source.priority || 'Medium',
      type: source.type || 'Functional',
      matrix: combination
    }));
    return { cases, total, generated: cases.length, truncated: total > cases.length };
  }

  function serializeDraft(draft) {
    const value = { ...draft, version: draft.version === 2 ? 2 : 1 };
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_STORAGE_CHARS) {
      throw new Error('Draft is too large to save locally (maximum 2 MB).');
    }
    return serialized;
  }

  function parseDraft(serialized) {
    const draft = JSON.parse(serialized);
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)
        || ![1, 2].includes(draft.version) || !Array.isArray(draft.cases)) {
      throw new Error('Saved draft has an unsupported or invalid format.');
    }
    if (draft.version === 1 && (!draft.template || typeof draft.template !== 'object' || !Array.isArray(draft.matrix))) {
      throw new Error('Saved draft has an unsupported or invalid format.');
    }
    if (draft.version === 2 && (!Array.isArray(draft.fields) || draft.fields.length > MAX_CONTROL_FIELDS
        || !Array.isArray(draft.conditions) || draft.conditions.length > MAX_CONDITIONS
        || draft.cases.length > MAX_CONTROL_CASES
        || draft.cases.some(testCase => !testCase || typeof testCase !== 'object' || Array.isArray(testCase)
          || typeof testCase.id !== 'string' || typeof testCase.title !== 'string'))) {
      throw new Error('Saved screen-form draft has an unsupported or invalid format.');
    }
    if (draft.version === 1 && draft.cases.some(testCase => !testCase || typeof testCase !== 'object' || Array.isArray(testCase))) {
      throw new Error('Saved draft has an unsupported or invalid format.');
    }
    const caseLimit = draft.version === 1 ? MAX_CASES : MAX_CONTROL_CASES;
    if (draft.cases.length > caseLimit) throw new Error(`Saved draft exceeds the ${caseLimit}-case limit.`);
    return draft;
  }

  function saveDraft(storage, draft) {
    if (!storage || typeof storage.setItem !== 'function') throw new Error('Browser storage is not available.');
    storage.setItem(STORAGE_KEY, serializeDraft(draft));
  }

  function loadDraft(storage) {
    if (!storage || typeof storage.getItem !== 'function') throw new Error('Browser storage is not available.');
    const serialized = storage.getItem(STORAGE_KEY);
    return serialized ? parseDraft(serialized) : null;
  }

  function clearDraft(storage) {
    if (!storage || typeof storage.removeItem !== 'function') throw new Error('Browser storage is not available.');
    storage.removeItem(STORAGE_KEY);
  }

  function safeSpreadsheetCell(value) {
    const text = String(value == null ? '' : value);
    return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  }

  function csvCell(value) {
    const text = safeSpreadsheetCell(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv(cases) {
    const headers = ['id', ...CASE_FIELDS, 'matrix'];
    const rows = cases.map(testCase => [
      testCase.id,
      ...CASE_FIELDS.map(field => testCase[field]),
      JSON.stringify(testCase.matrix || {})
    ]);
    return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
  }

  function exportControlCsv(cases) {
    const headers = ['id', 'fieldName', 'fieldType', 'title', 'input', 'expectedResult', 'condition', 'testType', 'priority', 'matrixValues', 'order', 'edited'];
    const rows = cases.map(testCase => headers.map(header => header === 'matrixValues'
      ? JSON.stringify(testCase.matrixValues || {})
      : testCase[header]));
    return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
  }

  function exportJson(template, matrix, cases) {
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      template,
      matrix,
      cases
    }, null, 2);
  }

  function exportControlJson(fields, conditions, cases) {
    return JSON.stringify({
      version: 2,
      mode: 'controls',
      exportedAt: new Date().toISOString(),
      fields,
      conditions,
      cases
    }, null, 2);
  }

  return {
    STORAGE_KEY,
    MAX_CASES,
    MAX_CONTROL_CASES,
    MAX_CONTROL_FIELDS,
    MAX_CONDITIONS,
    MAX_CONDITION_RULES,
    CASE_FIELDS,
    TEST_TYPES,
    CONTROL_CATEGORIES,
    createControl,
    normalizeControl,
    normalizeControls,
    validateConditions,
    generateFieldTestCases,
    generateDecisionTableMatrix,
    evaluateCondition,
    parseMatrixValues,
    normalizeMatrix,
    estimateCombinations,
    generateCases,
    serializeDraft,
    parseDraft,
    saveDraft,
    loadDraft,
    clearDraft,
    exportCsv,
    exportJson,
    exportControlCsv,
    exportControlJson
  };
});
