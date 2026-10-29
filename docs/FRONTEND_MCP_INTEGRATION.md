# Frontend Integration Guide for MCP, Chat, and API Execution

This document explains how a frontend application can use the QARP Playwright automation through the MCP server, a chat layer, and a thin API adapter.

## Overview

The QARP runner exposes an HTTP MCP endpoint from [runner-server.js](../runner-server.js). The chat UI discovers the active project's test files and calls MCP tools to list or execute tests without duplicating the Playwright test logic.

The current flow is:

1. Frontend or chat UI sends a request.
2. The chat client translates clear execution requests into MCP tool calls.
3. The runner discovers files from its active project and starts the requested Playwright run.
4. The repository runs the real Playwright spec.
5. The API returns a run summary and report metadata.

This keeps the frontend thin while the automation engine remains centralized in the existing Playwright framework.

## Current runtime contract

The runner currently exposes these MCP tools over HTTP JSON-RPC at `/mcp`:

- `list_test_files`
- `list_projects`
- `run_tests`
- `poll_job`
- `cancel_job`
- `get_history`
- `get_api_traffic`
- `run_self_test`
- `diagnose_failure`

The chat uses this workflow:

- `list_test_files` to discover the current project's files before resolving a prompt
- `run_tests` to start a run, followed by `poll_job` until the job completes
- `get_history`, `get_api_traffic`, or `run_self_test` for other supported chat requests

## Architecture for frontend integration

Recommended architecture:

```text
Frontend UI
   ↓
QARP Chat UI
  ↓ HTTP JSON-RPC
QARP Runner MCP Endpoint (/mcp)
   ↓
Active project Playwright tests
   ↓
Reports: tta-report/ and playwright-report/
```

Important note:

This repository uses an HTTP MCP endpoint, not an stdio server at `mcp/server.js`. The bundled UI calls the runner endpoint at the configured API base URL. For a production or internet-facing UI, keep the runner private and put authentication and authorization in a backend gateway; do not expose an unrestricted test runner publicly.

## Recommended backend pattern

For a separate frontend, a small authenticated API layer can wrap the MCP endpoint with routes such as:

- `/api/mcp/list-flows`
- `/api/mcp/run-flow`
- `/api/mcp/run-file`
- `/api/mcp/summary`
- `/api/mcp/report/:runId`

The adapter then calls the runner's HTTP MCP endpoint and returns a clean JSON payload to the frontend. These `/api/mcp/*` routes are integration examples; they are not implemented by this repository.

## Flow registry

The runner does not use a fixed business-flow registry. It discovers Playwright specs from the active project tree. QARP chat matches a request against those discovered file and folder names; ambiguous requests should be made specific by naming a path or folder.

The guide's former sample mappings are not part of this runtime. Configure a project by selecting its directory; then its actual discovered paths become available. For example:

- `Run tests/e2e/login.spec.js`
- `Run tests/e2e`
- `Run all tests`

The UI resolves named targets against `list_test_files`; it will not pass an unverified path into the MCP run call.

## Connect another project

1. Start QARP on a machine that can access the target project, using `npm start` from the QARP installation.
2. In the dashboard, use the project selector and choose a recent folder or enter the target project's absolute path. The target must be reachable from the runner host and contain Playwright tests or a Playwright config.
3. QARP updates the runner's active project without restarting, then refreshes project metadata and the test tree. Chat continues using the same `/mcp` endpoint, which now operates on that active project.
4. For a different machine running QARP, set the runner's reachable base URL in Settings, save, and confirm the Online status. The remote runner must allow the frontend origin through CORS and network policy.
5. To connect an external MCP client, use the HTTP endpoint `http://<runner-host>:<port>/mcp` with the MCP protocol version advertised by the endpoint. Do not use the stale stdio example below; this repository does not contain `mcp/server.js`.

The runner host must have Node.js, the target project's dependencies, Playwright, and required browser binaries installed. Do not expose an unauthenticated runner to untrusted networks.

## Legacy REST contract examples (not implemented)

The following `/api/mcp/*` routes and sample responses describe a possible adapter design only. They are not routes provided by this repository. Use the `/mcp` JSON-RPC endpoint and tool names listed above, or implement an authenticated adapter yourself.

### 1) List available flows

Request:

```http
GET /api/mcp/flows
```

Response:

```json
{
  "success": true,
  "flows": [
    {
      "key": "admission",
      "description": "Admission end-to-end flow",
      "aliases": ["admission", "admission module", "form filling"],
      "testFile": "tests/E2EadamissonToStudentlist/allFlow.spec.js"
    }
  ]
}
```

### 2) Run a natural-language flow

Request:

```http
POST /api/mcp/run-flow
Content-Type: application/json
```

Body:

```json
{
  "userRequest": "Run a test on admission module from form filling to fee payment",
  "module": "admission",
  "environment": "dev",
  "headed": false
}
```

Response:

```json
{
  "success": true,
  "runId": "run-1790577901687",
  "request": "Run a test on admission module from form filling to fee payment",
  "resolvedFlow": "Admission end-to-end flow",
  "testFile": "tests/E2EadamissonToStudentlist/allFlow.spec.js",
  "status": "failed",
  "error": "Command failed (1): ...",
  "reportPath": "D:\\DemoAutomation\\Testsuite\\tta-report"
}
```

### 3) Run a direct test file

Request:

```http
POST /api/mcp/run-file
Content-Type: application/json
```

Body:

```json
{
  "testFile": "tests/1_loginPage/login.spec.js",
  "project": "chromium",
  "headed": false
}
```

Response:

```json
{
  "success": true,
  "runId": "run-1790577901688",
  "status": "passed",
  "testFile": "tests/1_loginPage/login.spec.js",
  "summary": {
    "passed": 1,
    "failed": 0,
    "skipped": 0
  },
  "reportPath": "D:\\DemoAutomation\\Testsuite\\playwright-report"
}
```

### 4) Get the last run summary

Request:

```http
GET /api/mcp/last-run
```

Response:

```json
{
  "success": true,
  "runId": "run-1790577901687",
  "status": "failed",
  "testFile": "tests/E2EadamissonToStudentlist/allFlow.spec.js",
  "startedAt": "2026-09-28T12:15:07.000Z",
  "finishedAt": "2026-09-28T12:15:08.000Z"
}
```

### 5) Get report by run id

Request:

```http
GET /api/mcp/report/run-1790577901687
```

Response:

```json
{
  "success": true,
  "runId": "run-1790577901687",
  "reportUrl": "/reports/tta-report/index.html",
  "reportDir": "D:\\DemoAutomation\\Testsuite\\tta-report",
  "status": "failed",
  "output": "...full execution output..."
}
```

## HTTP JSON-RPC example

The bundled QARP UI uses this HTTP transport pattern. In production, call it from an authenticated backend adapter rather than exposing an unrestricted runner publicly.

```js
let requestId = 1;

async function callMcp(method, params = {}) {
  const response = await fetch('http://localhost:9300/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params })
  });
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message);
  return payload.result;
}

const tools = await callMcp('tools/list');
const files = await callMcp('tools/call', {
  name: 'list_test_files', arguments: {}
});
```

## Frontend UI flow

Recommended UX pattern:

1. Load available flows on page startup.
2. Let the user choose a flow or type a prompt.
3. Show a spinner while the MCP request is in progress.
4. On success, display run state and final result count.
5. Show links to:
   - TTA report
   - Playwright report
   - Last error output / attachments
6. Allow re-run of the same flow with a quick retry action.

## Example frontend usage

```js
const runTestFile = async (file) => {
  const response = await fetch('http://localhost:9300/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
      params: { name: 'run_tests', arguments: { file, headed: false } }
    })
  });
  return response.json();
};
```

## Security and operational rules

Runner integration must follow these rules:

- Do not expose an unauthenticated runner to untrusted networks. Use an authenticated backend gateway for production access.
- Validate all user inputs before sending them to the backend.
- Resolve requested files against `list_test_files` before running them.
- Restrict `environment`, `project`, and `headed` values to safe values.
- Do not accept arbitrary shell commands from UI input.
- Keep the runner responsible for spawning Playwright; never accept arbitrary shell commands from chat input.
- Save run metadata and report links for later viewing.

## Observability and reporting

The project automatically writes reports to:

- `tta-report/index.html`
- `playwright-report/`
- `allure-results/`

The frontend should display a report URL or open the report in a modal or new tab.

## Current limitations

This implementation is intentionally thin and follows the existing Playwright structure. The current MCP layer is designed as a bridge, not as a fully generalized workflow engine.

The main limitations are:

- natural-language matching is based on discovered names and is not fully semantic
- report metadata is basic and should be expanded for richer UI display
- production deployments should add an authenticated backend gateway

## Suggested next improvements

1. Add authentication and audit logging around test execution.
2. Return explicit report URLs and artifact links in MCP run results.
3. Improve natural-language matching and synonyms for discovered tests.
4. Add a dedicated UI execution history table.

## Summary

The frontend should not call Playwright directly. The correct pattern is:

- frontend → QARP HTTP MCP endpoint → active project's Playwright tests → report outputs

This is the cleanest and safest design for chat-driven automation and dashboard-triggered test execution.
