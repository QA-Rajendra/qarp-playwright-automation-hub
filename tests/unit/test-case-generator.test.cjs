'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const generator = require('../../js/test-case-generator.js');

test('parses matrix values, drops blanks, and deduplicates in stable order', () => {
  assert.deepEqual(generator.parseMatrixValues('admin, viewer\nadmin\n ,\nqa'), ['admin', 'viewer', 'qa']);
});

test('estimates and generates a deterministic Cartesian product with interpolated templates', () => {
  const matrix = [
    { name: 'role', values: ['admin', 'viewer'] },
    { name: 'browser', values: ['chromium', 'firefox'] }
  ];
  const template = {
    feature: 'sign-in',
    title: 'Sign in as {{role}} on {{browser}}',
    steps: 'Choose {{role}} / {{browser}}',
    expectedResult: '{{role}} can sign in'
  };

  assert.equal(generator.estimateCombinations(matrix), 4);
  const result = generator.generateCases(template, matrix);
  assert.equal(result.total, 4);
  assert.equal(result.generated, 4);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.cases.map(item => item.id), ['TC-001', 'TC-002', 'TC-003', 'TC-004']);
  assert.deepEqual(result.cases.map(item => item.matrix), [
    { role: 'admin', browser: 'chromium' },
    { role: 'admin', browser: 'firefox' },
    { role: 'viewer', browser: 'chromium' },
    { role: 'viewer', browser: 'firefox' }
  ]);
  assert.equal(result.cases[0].title, 'Sign in as admin on chromium');
  assert.equal(result.cases[3].expectedResult, 'viewer can sign in');
});

test('generates one base scenario with no matrix and requires confirmation above the cap', () => {
  const template = { feature: 'checkout', title: 'Checkout {{feature}}' };
  assert.equal(generator.generateCases(template, []).generated, 1);
  const matrix = [{ name: 'option', values: Array.from({ length: 201 }, (_, index) => String(index)) }];
  assert.throws(
    () => generator.generateCases(template, matrix),
    error => error.code === 'MATRIX_LIMIT_CONFIRMATION_REQUIRED' && error.total === 201 && error.limit === 200
  );
  const capped = generator.generateCases(template, matrix, { confirmTruncate: true });
  assert.equal(capped.generated, 200);
  assert.equal(capped.truncated, true);
  assert.equal(capped.cases.at(-1).matrix.option, '199');
});

test('rejects invalid and duplicate matrix column names and empty values', () => {
  assert.throws(() => generator.normalizeMatrix([{ name: '', values: ['x'] }]), /needs a name/);
  assert.throws(() => generator.normalizeMatrix([
    { name: 'role', values: ['admin'] },
    { name: 'ROLE', values: ['viewer'] }
  ]), /duplicated/);
  assert.throws(() => generator.normalizeMatrix([{ name: 'browser', values: [] }]), /at least one value/);
});

test('persists and restores a versioned draft and rejects malformed or oversized data', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const draft = { template: { feature: 'search' }, matrix: [], cases: [] };
  generator.saveDraft(storage, draft);
  assert.deepEqual(generator.loadDraft(storage), { ...draft, version: 1 });
  assert.throws(() => generator.parseDraft('{broken'), /JSON|property/i);
  assert.throws(() => generator.parseDraft(JSON.stringify({ version: 2, template: {}, matrix: [], cases: [] })), /unsupported/);
  assert.throws(() => generator.parseDraft(JSON.stringify({
    version: 2, fields: [], conditions: [], cases: [null]
  })), /unsupported or invalid format/);
  assert.throws(() => generator.serializeDraft({ template: {}, matrix: [], cases: ['x'.repeat(2_000_001)] }), /2 MB/);
  generator.clearDraft(storage);
  assert.equal(generator.loadDraft(storage), null);
});

test('CSV export quotes special characters and protects spreadsheet formulas', () => {
  const csv = generator.exportCsv([{
    id: 'TC-001',
    title: '=HYPERLINK("https://example.test","open")',
    preconditions: 'row 1\nrow 2',
    steps: 'say "hello", then continue',
    expectedResult: '+1',
    priority: 'High',
    type: 'Functional',
    matrix: { role: '-admin' }
  }]);

  assert.match(csv, /^\uFEFF"id","title","preconditions"/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.test"",""open""\)"/);
  assert.match(csv, /"row 1\nrow 2"/);
  assert.match(csv, /"say ""hello"", then continue"/);
  assert.match(csv, /"'\+1"/);
  assert.match(csv, /"\{""role"":""-admin""\}"/);
});

test('JSON export preserves template, matrix and case records in a versioned envelope', () => {
  const template = { feature: 'login' };
  const matrix = [{ name: 'role', values: ['admin'] }];
  const cases = [{ id: 'TC-001', matrix: { role: 'admin' } }];
  const result = JSON.parse(generator.exportJson(template, matrix, cases));
  assert.equal(result.version, 1);
  assert.deepEqual(result.template, template);
  assert.deepEqual(result.matrix, matrix);
  assert.deepEqual(result.cases, cases);
});

test('normalizes screen controls and creates eight technique cases for each field', () => {
  const fields = [
    generator.createControl('Username', 'text', 'Text', { required: true, min: 3, max: 20, errorRequired: 'Username is required', errorInvalid: 'Invalid input' }),
    generator.createControl('Login', 'submit', 'Button')
  ];
  const cases = generator.generateFieldTestCases(fields);

  assert.equal(cases.length, fields.length * 8);
  assert.deepEqual([...new Set(cases.map(item => item.testType))], generator.TEST_TYPES);
  assert.equal(cases.filter(item => item.fieldId === fields[0].id).length, 8);
  assert.equal(cases[0].id, 'TC001');
  assert.equal(cases.find(item => item.testType === 'Positive').title, 'Valid value');
  assert.match(cases.find(item => item.testType === 'Positive').condition, /IF valid value THEN Accepted ELSE/);
  assert.equal(cases.find(item => item.testType === 'Boundary').title, 'Min length (3)');
  assert.ok(cases.find(item => item.testType === 'Negative').expectedResult.includes('Username is required'));
  assert.ok(cases.find(item => item.testType === 'Negative').expectedResult.includes('Invalid input'));
  assert.ok(cases.find(item => item.testType === 'Boundary').input.includes('2 / 3'));
  assert.ok(cases.find(item => item.testType === 'Boundary').input.includes('20 / 21'));
  assert.throws(() => generator.normalizeControl({ name: 'Age', type: 'number', min: '20', max: '1' }), /minimum not greater/);
  assert.throws(() => generator.normalizeControl({ name: 'Username', type: 'text', min: 'many' }), /non-numeric minimum/);
  assert.throws(() => generator.normalizeControl({ name: 'Country', type: 'select' }), /needs at least one dropdown\/radio option/);
  assert.deepEqual(generator.normalizeControl({ name: 'Country', type: 'select', options: 'US,CA' }).options, 'US,CA');
  assert.throws(() => generator.normalizeControl({ name: 'Attachment', type: 'file', fileTypes: 'pdf' }), /must be extensions/);
  assert.throws(() => generator.normalizeControl({ name: 'Attachment', type: 'file', maxFileSize: 'large' }), /invalid maximum file size/);
  const radio = generator.createControl('Plan', 'radio', 'Choice', { options: 'Free,Pro' });
  assert.equal(generator.generateFieldTestCases([radio]).find(item => item.testType === 'Positive').input, 'Free');
  const upload = generator.createControl('Attachment', 'file', 'File', { fileTypes: '.pdf', maxFileSize: '5MB' });
  assert.match(generator.generateFieldTestCases([upload]).find(item => item.testType === 'Boundary').input, /5MB \/ above 5MB/);
});

test('validates, evaluates, and generates cases for IF/ELSE conditions', () => {
  const fields = [
    generator.createControl('Username', 'text', 'Text', { required: true }),
    generator.createControl('Password', 'password', 'Text', { required: true }),
    generator.createControl('Login', 'submit', 'Button')
  ];
  const conditions = [{
    id: 'login-ready',
    rules: [
      { fieldId: fields[0].id, operator: 'is empty', value: '', join: 'AND' },
      { fieldId: fields[1].id, operator: 'is empty', value: '', join: 'OR' }
    ],
    thenAction: 'Disable', thenTarget: fields[2].id,
    apply: 'On field change', elseAction: 'Enable', elseTarget: fields[2].id
  }];
  const normalized = generator.validateConditions(conditions, fields);
  assert.equal(generator.evaluateCondition(normalized[0], { [fields[0].id]: 'qa', [fields[1].id]: '' }), true);
  assert.equal(generator.evaluateCondition(normalized[0], { [fields[0].id]: 'qa', [fields[1].id]: 'secret' }), false);
  assert.throws(() => generator.validateConditions([{ ...conditions[0], apply: 'At random time' }], fields), /unsupported apply timing/);
  assert.equal(generator.validateConditions([{ ...conditions[0], apply: 'On page load' }], fields)[0].apply, 'On page load');
  assert.equal(generator.validateConditions([{ ...conditions[0], apply: 'On submit' }], fields)[0].apply, 'On button click');
  const cases = generator.generateFieldTestCases(fields, conditions);
  assert.equal(cases.filter(item => item.testType === 'Condition').length, 2);
  assert.match(cases.at(-1).expectedResult, /false, enable Login/);
  assert.throws(() => generator.validateConditions([{ ...conditions[0], thenTarget: 'missing' }], fields), /valid THEN action/);
  assert.throws(() => generator.validateConditions([{
    ...conditions[0],
    rules: Array.from({ length: generator.MAX_CONDITION_RULES + 1 }, () => conditions[0].rules[0])
  }], fields), /at most 50 IF rules/);
});

test('generates the full 3-state decision table matrix for form inputs', () => {
  const fields = [
    generator.createControl('Username', 'text', 'Text', {
      required: true, min: 3, max: 20, errorRequired: 'Username is required', errorInvalid: 'Invalid username'
    }),
    generator.createControl('Password', 'password', 'Text', {
      required: true, min: 8, max: 16, errorRequired: 'Password is required', errorInvalid: 'Invalid password'
    }),
    generator.createControl('Remember me', 'checkbox', 'Choice'),
    generator.createControl('Login', 'submit', 'Button')
  ];

  const cases = generator.generateDecisionTableMatrix(fields);
  assert.equal(cases.length, 27);
  assert.equal(cases[0].id, 'M001');
  assert.deepEqual(cases[0].matrixValues, {
    [fields[0].id]: 'Valid',
    [fields[1].id]: 'Valid',
    [fields[2].id]: 'Valid'
  });
  assert.equal(cases[0].testType, 'Decision Table Matrix');
  assert.match(cases[0].expectedResult, /submits successfully/);
  assert.match(cases[1].expectedResult, /Username: Invalid username/);
  assert.match(cases[2].expectedResult, /Username: Username is required/);
  assert.match(cases[18].input, /Remember me: Empty/);
  assert.equal(cases[18].expectedResult, 'Form submits successfully');
  const csv = generator.exportControlCsv(cases);
  assert.match(csv, /"M001","Whole form","Form","All fields valid"/);
  assert.ok(csv.includes(JSON.stringify(cases[0].matrixValues).replace(/"/g, '""')));
  assert.throws(() => generator.generateDecisionTableMatrix(fields, 26), /exceeding the 26-case limit/);
  assert.throws(() => generator.generateDecisionTableMatrix([
    generator.createControl('Login', 'submit', 'Button')
  ]), /at least one input control/);
});

test('persists v2 control drafts with more than 200 generated cases', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const fields = Array.from({ length: 34 }, (_, index) => generator.createControl(`Field ${index + 1}`, 'text'));
  const cases = generator.generateFieldTestCases(fields);
  assert.ok(cases.length > generator.MAX_CASES);
  generator.saveDraft(storage, { version: 2, fields, conditions: [], cases });
  assert.equal(generator.loadDraft(storage).cases.length, cases.length);
});

test('exports control cases with their screen fields and conditions', () => {
  const fields = [generator.createControl('Email', 'email', 'Text', { required: true })];
  const conditions = [];
  const cases = generator.generateFieldTestCases(fields, conditions);
  const csv = generator.exportControlCsv(cases);
  const json = JSON.parse(generator.exportControlJson(fields, conditions, cases));

  assert.match(csv, /^\uFEFF"id","fieldName","fieldType","title","input","expectedResult","condition","testType","priority","matrixValues"/);
  assert.match(csv, /"Email","email","Valid value","qa@example\.test","Accepted","IF valid value THEN Accepted ELSE show the error message","Positive"/);
  assert.equal(json.version, 2);
  assert.equal(json.mode, 'controls');
  assert.deepEqual(json.fields, fields);
  assert.deepEqual(json.conditions, conditions);
  assert.deepEqual(json.cases, cases);
});
