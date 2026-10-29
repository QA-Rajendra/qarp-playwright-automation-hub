# QARP Project Integration Review and Optimization Plan

## Review scope and confidence

This is a static source review of the dashboard, standalone pages, browser controllers, runner routes, package metadata, and current tests. It checks declared frontend-to-server connections and shared behavior; it is not a full runtime verification or security audit. The test command could not run in this Windows sandbox, and the pages were not exercised in a browser.

## Overall status (original review baseline)

QARP has a clear core flow: the dashboard and its controllers call a local Node runner, while dedicated pages provide history/results, MCP inspection, project analysis, REA analysis, website walkthrough recording, snippets, SQL building, and Git status. Most local page links and the checked page-to-route pairs are connected.

However, the system is not yet consistently integrated end to end:

1. The MCP Inspector's scenario execution flow does not connect to the server started by the normal QARP command, and its expected response does not match the scenario server's response.
2. The package's advertised Express middleware export is currently a pass-through and does not provide the documented runner routes.
3. API fallback behavior can make unavailable or failed server operations look like valid mock/empty results.
4. Theme behavior is not consistent across the standalone pages; Blue controls/styles remain on the Snippets page despite Blue being removed from the supported theme manager.
5. Package name, repository URL, dependency, and README install identity are inconsistent.
6. The CLI intentionally binds to all network interfaces, while the server uses permissive CORS and exposes project/process/file operations. LAN sharing needs an explicit access-control design before treating the dashboard as safe for untrusted networks.
7. The runner is a large single module, while page-specific controllers and inline code implement overlapping fetch, theme, navigation, and error behavior.
8. Static inspection found credential-like login values embedded in the separate scenario runner's generated browser script. Their values are intentionally not repeated here; treat them as exposed, remove them from source, and rotate them if they are real.

**Recommendation:** do not begin broad refactoring first. Close the broken scenario flow, publish/middleware contract, and network-boundary questions; then establish integration tests before moving shared code.

## Implementation update

The review findings below describe the original static-review baseline. The following items have since been implemented in source:

- The Inspector scenario flow now uses the normal QARP server, validates input, reports a real asynchronous job status, and serves per-run screenshot/video artifacts. It captures page-load evidence only; notes are not executed as AI instructions or assertions.
- The obsolete second scenario server and its embedded login flow were removed. If any removed credential was real, rotate it because deleting source does not revoke a credential previously committed or shared.
- Express/Connect middleware now proxies the complete runner UI and API under the mount path, adjusts same-origin fetches for that prefix, and exposes a `close()` method.
- The CLI and standalone server default to loopback. LAN binding requires an explicit opt-in and warning; there is no LAN authentication, so LAN mode is for trusted networks only. CORS is same-origin by default with an exact-origin allowlist option.
- Package name, CLI alias, README install command, lockfile root metadata, and the canonical repository are aligned; the erroneous self-dependency is removed.
- Snippets now has an actual Sage palette and offers Sage Slate instead of Blue. MCP Inspector and Snippets no longer offer Blue as a selectable theme. Legacy Blue preference values still migrate to Sage for compatibility.
- Added an isolated Playwright E2E configuration and three local browser flows for dashboard navigation, Sage theme persistence, and MCP Inspector scenario evidence (including rejected input, status polling, and artifact reads). Added `npm run test:e2e` and the combined `npm test` command.
- The new browser test caught and fixed the dashboard expanding Quick Links on startup despite its collapsed markup. All three Chromium E2E flows pass via the VS Code test runner. The Node unit test files are not discovered by that runner, so `npm run test:unit` remains unverified. See [runtime-validation-report.md](./runtime-validation-report.md).

Still outstanding: API mock/offline state can be misleading, theme behavior is not yet unified across every standalone page, broader route/browser coverage, clean package-install checks, and Git-status state coverage remain, and the large runner module has not been split. The Windows BaseContainer sandbox prevented terminal test execution; Firefox and WebKit validation also remain outstanding.

## Page and integration map

| Surface | Connected behavior | Review result |
|---|---|---|
| Dashboard (`index.html`) | Loads the shared config, API, theme, common UI, test-tree, runner, dashboard, and AI controllers. Quick Links point to the standalone tools. | Hub page; links to the checked local tool pages resolve. Some API fallbacks can present placeholder state; the disconnected-API branch placeholder now reports `unknown` rather than `main`. |
| History (`pages/history.html`) | Shared API/theme/common scripts and history controller; uses history and structured-run APIs. | Routes align with runner endpoints on the checked surface. |
| Results (`pages/results.html`) | Shared API/theme/common scripts and results controller; uses run insights, failed-rerun, report, history, and API traffic operations. | Routes align with runner endpoints on the checked surface. |
| MCP Inspector (`pages/mcp-inspector.html`) | Uses `/mcp`, named-project, project-path, project-detect, clone-project, and local scenario-evidence operations. Has its own inline UI/controller. | The ordinary project operations have matching runner routes. Browser scenario evidence now posts to the runner, polls a job, and retrieves artifacts. Scenario notes are not executed as AI instructions or assertions. Blue-specific overrides were removed. |
| Git Workflow (`pages/git-workflow.html`) | Calls `GET /git-status` for the server's active project. | New read-only endpoint and page are connected. It is local-request-only; opening QARP through a LAN address will not be supported by this page. Its hard-coded Sage palette does not follow a saved Default preference. |
| Project Analyzer (`pages/project-analyzer.html`) | Calls `GET /project-analysis`. | Matching server route. Standalone page does not load the shared theme controller/stylesheet. |
| REA Analyzer (`pages/rea-analyzer.html`) | Reads `/project-path`, then calls `POST /rea/analyze`. | Matching server routes and local-request restriction. Standalone page does not load the shared theme controller/stylesheet. |
| Walkthrough Recorder (`pages/walkthrough-recorder.html`) | Uses `/walkthrough/start`, `/status`, `/inspect`, `/action`, `/artifact`, and `/stop`. | Matching route family; protected as a local-only feature. Standalone page does not load the shared theme controller/stylesheet. |
| Snippets (`pages/snippets.html`) | Self-contained snippet UI; no runner API dependency. Loads the shared theme manager. | Offers Default and Sage Slate with a page-specific Sage palette; legacy Blue preference values are migrated by the shared theme manager. |
| SQL Builder (`pages/sql-builder.html`) | Self-contained inline CSS/JS; no runner API dependency. | No shared hub-back navigation or shared theme controller, unlike the other dashboard tools. This may be intentional but makes the tool feel disconnected. |
| Former AI Scenario Server | Previously started independently on port 9301. | Removed. Its functionality was replaced with the local browser evidence capture endpoint in `runner-server.js`; this is not an AI agent. |

### Confirmed integration failures (original review baseline)

#### MCP Inspector scenario runner

- The Inspector sends a request to `/api/run-scenario` on port 9300, but the route is implemented in the separate `ai-scenario-server.js`, which listens on port 9301.
- The standard start script launches only `runner-server.js`; it does not launch the separate scenario server.
- The Inspector expects a successful response with a report and refers to a generated video, while the scenario server returns a `started` response and does not provide those artifacts.
- The Inspector sends a browser selection, but the scenario server always launches Chromium.

This workflow should be unified under one supported start/run model and one response contract, or the UI should clearly identify and require the separate service and its actual capabilities.

#### Theme mismatch

`js/theme.js` intentionally maps legacy Blue selections to Sage. `pages/snippets.html` still presents Blue as a selectable palette and contains Blue theme rules, so its label and rendered theme disagree. MCP Inspector styling also contains Blue-specific rules that no longer correspond to a selectable theme. Git Workflow, Project Analyzer, REA Analyzer, and Walkthrough Recorder do not share the main theme controller/styles. SQL Builder is fully self-contained.

#### Misleading or unverified integrations

- The API client uses fallbacks for structure, browser projects, test runs, diagnosis, report launching, history, and captured traffic. Some are appropriate for a clearly labeled offline/demo mode, but silent fallback can make a server failure look like a real empty or successful result.
- `getStructure`/dashboard summary can report `main` when live branch discovery fails. This is placeholder output, not proof the active project is on `main`.
- `runnerMiddleware()` currently calls `next()` for all requests; its options and route allowlist are unused. The exported middleware therefore does not implement the runner integration described by its name/package exports.
- The README's GitHub install identity and examples do not agree with the package's declared name, self-dependency, and repository URL.

## Optimization plan

### Phase 0 — Establish the supported product contract

1. Select one canonical npm/package name, repository URL, CLI command, and GitHub install source. Remove or justify the package's self-dependency and align README examples and package metadata.
2. Decide whether Express/Connect middleware is a supported product feature. If yes, implement and test the actual request/static-serving integration. If not, remove the misleading export and document the standalone server API only.
3. Decide whether the AI Scenario feature is in scope. If it is, integrate it with the normal server lifecycle and define one request/response/artifact contract; otherwise, remove or mark the Inspector controls as unavailable rather than showing a broken run action.

**Exit criteria:** a clean package install follows one documented path, and every advertised run mode starts the required services.

### Phase 1 — Protect the runner and make failures visible

1. Remove embedded credentials from the scenario runner and generated test script. Rotate them if they are valid; source removal alone does not invalidate exposed credentials.
2. Choose a safe default network policy: loopback-only by default; LAN exposure must be explicit and protected by a documented authentication/access-control mechanism.
3. Replace wildcard CORS with an explicit same-origin/allowlist policy consistent with supported deployment modes.
4. Inventory all routes that launch processes, inspect arbitrary project paths, or write files. Apply common request-size limits, authorization policy, canonical path validation, and explicit error responses.
5. Stop converting non-success HTTP responses into mock success. Label simulated mode visibly and preserve the original error/status so a failed run cannot be mistaken for a real test result.
6. Keep Git status read-only and local-only unless the network/auth model is deliberately expanded.

**Exit criteria:** local and LAN operation have distinct documented trust boundaries; invalid/unavailable backend responses are visibly errors or explicitly labeled simulation.

### Phase 2 — Unify page-to-runner contracts and shared UX

1. Maintain a route contract table mapping page/controller method → HTTP method/path → server handler → response/error shape. Add tests for every route used by a page.
2. Give standalone pages a shared API-base/path-prefix strategy so direct server use and any supported mounted deployment agree.
3. Centralize page theme initialization and remove unsupported Blue controls/styles. Make Git Workflow, Project Analyzer, REA, Walkthrough, and SQL Builder either follow the shared theme/navigation contract or document their deliberate independence.
4. Replace placeholder branch values with explicit `unknown`, `not a repository`, or live status states.
5. Standardize loading, empty, unavailable, and error states across pages; preserve HTTP failure details instead of silently substituting data.

**Exit criteria:** every sidebar link loads, calls the expected server/API contract, and renders consistent theme/error states. No inactive theme is advertised.

### Phase 3 — Refactor for maintainability and measured performance

1. Split `runner-server.js` by responsibility (HTTP/static serving, project management/analyzer, test execution/history, MCP, walkthrough/REA/Git) behind the existing `createRunnerServer` public facade. Preserve public route and module contracts during extraction.
2. Reduce blocking work on the HTTP event loop. Measure project scanning, test-tree discovery, trace/HAR extraction, report generation, and history reads before changing algorithms; move demonstrably expensive work off the request path or cache it with correct invalidation.
3. Replace ad hoc Playwright configuration text parsing with a supported configuration-loading approach where safe, or report unsupported/dynamic config accurately rather than guessing browser projects.
4. Consolidate duplicated API/theme/navigation code only after Phase 2 tests establish behavior; avoid a broad rewrite without a baseline.
5. Keep large request/response and test artifact handling bounded, document retention, and avoid storing redundant HAR/trace/API copies where possible.

**Exit criteria:** measured hot paths improve without regressions; route contract and behavior tests continue to pass.

### Phase 4 — Repeatable validation and release

1. Keep `npm run test:unit` focused on deterministic unit tests; add API/integration tests that start the runner against temporary project fixtures.
2. Add browser smoke tests for the dashboard and every linked local page: page load, no uncaught console errors, route response shape, theme selection, navigation/back links, and basic empty/error states.
3. Add a clean-install/package-content test, CLI startup smoke test, supported middleware test (if retained), and CI workflow to run checks.
4. Test with no Git repository, an empty/unborn Git repository, staged and unstaged files, no upstream, and an unavailable Git executable for Git Workflow.
5. Record browser-binary/environment prerequisites separately from code failures.

**Exit criteria:** the documented install/start path and every primary page flow pass automated checks in a clean environment.

### Validation closeout plan

The local Playwright scaffold and Chromium flows have been implemented; the VS Code test runner reported 3 passed and 0 failed. This does not complete the gates: the Node unit command, install/package/CLI checks, and Firefox/WebKit runs remain unverified. See [runtime-validation-report.md](./runtime-validation-report.md). Run the remaining steps in order in a terminal-enabled environment and record exact commands, exit codes, counts, and blocker output.

#### Gate 1 — Verify prerequisites and install reproducibly

1. In PowerShell, record `node --version` and `npm --version`. The package requires Node.js `>=22.12.0`; resolve a version mismatch before running tests.
2. Run `npm ci` from the repository root and record its exit code. This verifies the committed lockfile rather than relying on a developer's existing `node_modules`.
3. Record `npx playwright --version`, then independently attempt `npx playwright install chromium`, `npx playwright install firefox`, and `npx playwright install webkit`. Do not treat a failed engine installation as a test failure; record the exact engine, command, and error, and mark browser coverage for that engine unverified.
4. Docker is not a prerequisite for the current project: the runner and UI have no container-managed database, message broker, or other infrastructure dependency. Node.js and the Playwright browser binaries are independent prerequisites.

**Gate passes when:** clean dependency installation succeeds and the required Node version is active. Browser installation outcomes are recorded separately by engine.

#### Gate 2 — Run the canonical unit suite

Run `npm run test:unit` after the clean install. It explicitly covers the run-insights reporter, Git status parser, scenario input/artifact handling, and runner middleware/network behavior.

Capture the command's process exit code and the reported passed/failed/skipped counts. A nonzero exit code is a failure even if some tests pass; investigate and fix test-code or environment issues, then rerun the same command. Do not report the earlier VS Code test discovery that executed zero tests as a pass.

**Gate passes when:** `npm run test:unit` exits `0`, with no unexplained failures or skips.

#### Gate 3 — Add and run deterministic runner integration checks

Before calling the API integration tier complete, extend automated coverage for the changed runner contract using temporary project/output directories and loopback-only servers:

- Exercise a valid scenario submission, its `202` job response, status polling through a terminal state, and retrieval of generated screenshot/video artifacts; assert artifact content type and that the files remain inside the run directory.
- Cover malformed payloads, unsupported browser names, cross-origin rejection, missing/unknown job IDs, missing artifacts, and cleanup/error behavior. The product has no user login/authentication flow; test the implemented local-request and Origin boundaries instead of asserting a nonexistent login.
- Exercise the middleware at its mounted base path, including UI HTML, a runner API request, the mount-prefix fetch bootstrap, cross-origin rejection, and clean shutdown. Keep the existing middleware test as part of this suite.
- Use a local test page/server as the scenario target. Do not make scenario acceptance depend on a public website or persist test artifacts in the repository.

Run the integration tests through the canonical `npm run test:unit` command (or wire any separately named integration command into the documented CI command). Record exact counts and exit code.

**Gate passes when:** the scenario lifecycle and middleware behavior above are covered by runnable tests and the canonical command exits `0`.

#### Gate 4 — Configure and execute QARP browser smoke tests

The current Playwright config points at `./tests`, which also contains Node built-in unit tests. Separate browser-test discovery from `tests/unit` before running Playwright (for example, scope the browser config to a dedicated `tests/e2e` directory). Keep `npm run test:unit` as the Node test runner's independent command.

Add at least three deterministic, multi-step Playwright smoke tests using only the local runner and local fixtures:

1. **Dashboard and navigation:** start QARP, load the dashboard, visit every linked local tool page, verify successful local navigation and no uncaught page errors, and return to the dashboard.
2. **Theme and page behavior:** verify Sage is the default where specified, exercise the supported theme controls, and check key loading/empty/error states on representative standalone pages.
3. **Scenario capture flow:** submit a local fixture URL from MCP Inspector, verify validation and job status progression, then retrieve and validate the run artifact. Include a rejected invalid request and verify its visible error state.

Run the app smoke suite first against Chromium with `npx playwright test --project=chromium` using the dedicated browser-test config. Then run the same suite against Firefox and WebKit where their browser installs succeeded. Keep the existing `tests/QAtest` example.com and JSONPlaceholder tests classified as network-dependent demos; they do not prove QARP UI or runner integration and are not substitutes for these smoke tests.

**Gate passes when:** the new QARP flows pass in Chromium and all additional installed browser projects, with any unavailable engine explicitly marked unverified rather than silently skipped.

#### Gate 5 — Startup, package, and Git-status regressions

- Start the runner using the documented `npm start` command, wait for the local UI/readiness response, and verify a representative API response. Capture startup time, readiness signal, and shutdown result.
- Run `npm pack --dry-run` and inspect the package file list for the runner, scenario runner, UI pages, assets, and documentation. Where a clean temporary install is possible, install the generated package into a temporary consumer and verify its documented startup/middleware entry points.
- Exercise Git Workflow against a normal repository, a non-repository directory, an empty/unborn repository, staged plus unstaged changes, no upstream, and a missing Git executable. Verify the page reports unknown/unavailable states honestly and remains read-only.
- Confirm generated reports, HARs, traces, screenshots, videos, and temporary package files are not accidentally committed; remove only test outputs created by this validation run.

**Gate passes when:** startup, package-content checks, supported public entry points, and the listed Git states behave as documented with successful exit codes.

#### Evidence and final acceptance

Produce a `runtime-validation-report.md` with the execution date, Node/npm versions, browser installation results per engine, commands and exit codes, test counts, startup/readiness evidence, package check result, failures/fixes, and remaining gaps. Use `UNVERIFIED` for a tier that could not be attempted or completed; do not convert sandbox or missing-browser blockers into a pass.

Final validation is complete only when Gates 1–5 have the evidence above, all executed required commands exit `0`, and no required flow is silently skipped. If the Windows sandbox blocks command execution, record the precise blocked command and environment limitation, leave the affected gates `UNVERIFIED`, and resume the same plan in an environment that permits Node/npm and browser execution.

## Suggested order

1. Resolve the scenario-runner page/API mismatch.
2. Confirm package identity and whether middleware is supported; implement or remove the broken advertised path.
3. Agree on the network exposure/auth policy before team/LAN use.
4. Add route/page integration tests and make mock/offline status explicit.
5. Align themes, shared navigation, and placeholder branch behavior.
6. Refactor and optimize only against a passing integration baseline and measured bottlenecks.

## Validation performed for this review

- Static source inspection of package metadata, runner route handlers, shared API/controller code, page calls, navigation, and current test files.
- The existing `npm run test:unit` command could not start because this Windows sandbox does not support command execution. No test pass/fail result is available.
- No browser-based smoke test or live service request was run.

## Completion criteria for a follow-up implementation

- All findings in the confirmed-integration-failures section have an explicit resolution or accepted product decision.
- All Quick Links and page-back links resolve to packaged files.
- Every page API call has a server handler and tested success/error response contract.
- Scenario-run controls reflect actual service, browser, report, and artifact behavior.
- Theme options agree with the applied palette across every page.
- Network access, CORS, file writes, path selection, and process execution follow a documented and tested trust policy.
- Unit, server integration, browser smoke, package install, and startup checks pass in a supported environment.
