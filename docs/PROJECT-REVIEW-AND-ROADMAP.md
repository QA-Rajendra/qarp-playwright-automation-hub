# QARP Project Review and Feature Roadmap

## Purpose and review scope

This review is based on the checked-in source and documentation, primarily `package.json`, `README.md`, `runner-server.js`, the browser-side controllers in `js/`, and the dashboard pages. It is a static source review; the application and its tests were not run as part of this review.

## Implementation status

The local Test Run Insights MVP described below has been implemented in the dashboard and MCP run lifecycle: versioned per-test reports, history links/comparison, validated failed-test rerun previews, and bounded/redacted local API traffic. CI artifact integration remains out of scope. Validation is incomplete: the focused Node test command could not run because the Windows sandbox is unsupported in this environment, and VS Code test discovery found no executable tests for the Node built-in test file.

## What QARP is today

QARP is a local Playwright automation hub with a vanilla JavaScript dashboard and a Node.js server. It can be started as a CLI/local server, imported from Node.js, or mounted as Express middleware. Its current surfaces include:

- A test explorer and run controls for selecting test files, browser projects, grep tags, flags, and timeouts, with live output and cancellation.
- A dashboard with environment selection, runner-session management, summary/history views, and links to reports.
- Execution history, HTML/Allure report launching, API traffic capture, and rule-based failure diagnosis.
- An MCP endpoint exposing project/test discovery, test execution and polling, history, API traffic, self-test, and diagnosis tools/prompts.
- A read-only project analyzer for languages, manifests, frameworks, versions, and Playwright projects.
- A REA interface for analyzing JavaScript application folders and Electron `.asar` files.
- A Puppeteer-based website walkthrough recorder that can interact with pages and produce screenshots, PDFs, and Markdown.

The strongest product idea is that QARP puts test execution and several useful forms of QA investigation behind one local interface, while also making those operations available to AI clients through MCP.

## Observations that matter for the next feature

1. **Run results are currently summarized more than modeled.** The server parses human-readable Playwright output into aggregate pass/fail/skip counts and a list of failed-test labels. History stores the command, timestamp, totals, and exit code. This is useful for audit/history, but is not yet a durable per-test result model for comparing a particular test across runs.
2. **There are existing building blocks for richer triage.** The project already records run history, captures network traffic from traces, displays run results, and classifies common error patterns. A new insights feature can connect these rather than introducing a separate diagnostic product.
3. **The current diagnosis is heuristic.** Failure categories and suggested fixes are based on matching error text. Treat these suggestions as hypotheses and show the matched evidence; do not present them as confirmed root causes.
4. **Captured data needs an explicit privacy policy.** API traffic may include headers, request/response bodies, or page data. Before expanding its retention, display, export, or AI use, redact credentials and sensitive fields and give users clear retention/clear controls.
5. **The release/package identity needs reconciliation.** `package.json`, the README install examples, the `bin` name, the declared GitHub dependency, and the repository URL do not consistently use one package/repository identity. Resolve the canonical package name and install source before publishing or writing release automation.
6. **Validation is not yet discoverable as a standard workflow.** The manifest provides `start` and `test:ui` (which starts the server), but no focused unit-test, lint, or build script. The checked-in sample tests demonstrate API calls; they are not a regression suite for the dashboard/server features.

## Recommended first feature: Test Run Insights

Add a trustworthy view of **which tests passed, failed, were skipped, or were flaky on each run**, and let users compare runs and act on the failed tests. This extends existing history, results, API capture, and diagnosis instead of duplicating them.

### User outcome

After a run, a QA engineer can identify the exact failing or flaky tests, compare their outcome against a previous run, inspect supporting error/network evidence, and rerun only the affected tests.

### MVP scope

- Capture structured Playwright JSON results for each QARP-launched run.
- Normalize a run and its test results into a versioned, bounded local history format. Keep reading the existing aggregate history format during transition.
- Record stable test identity where Playwright supplies it (project, file, title/repeat or retry identity), status, duration, retry information, and failure message/location. Avoid storing full test artifacts or request bodies by default.
- Add a run-details view linked from the existing result and history views.
- Compare two selected runs for added failures, resolved failures, and status changes.
- Add an explicit flaky label only when the structured results provide evidence, such as a test failing on an attempt and passing on a retry. Do not infer flakiness from a single failure.
- Provide a rerun-failed action using validated test paths and project names, with a preview of the command before execution.
- Show rule-based diagnosis as a suggestion with the error text/location that triggered it.
- Redact secrets and sensitive values before storing or displaying API traffic or error context; document which data remains local and how to clear it.

### Out of scope for the first release

- Automatically changing test files or applying generated fixes.
- Cloud accounts, hosted result storage, team identity, or shared multi-user history.
- Replacing Playwright's own HTML report or Allure.
- Claiming statistically meaningful flakiness from a small or incomplete run history.
- Sending test data to an external AI service by default.

## Implementation plan

### Phase 0 — Define the result contract and safety rules

1. Define a versioned run/result JSON schema, including run ID, timestamp, selected projects, duration, totals, and per-test outcomes.
2. Decide the supported Playwright JSON reporter integration for projects that already configure reporters; verify it does not overwrite existing reports or user configuration.
3. Define path/project validation, output/artifact size limits, retention behavior, and redaction rules for headers, URLs, request/response bodies, and errors.
4. Add representative fixtures for passing, failing, skipped, retried/flaky, multiple-project, and incomplete/interrupted runs.

**Exit criteria:** schema and fixtures cover the named cases; legacy aggregate history remains readable; sensitive fields have explicit redaction tests.

### Phase 1 — Persist structured results

1. Extend the run lifecycle to capture structured results alongside the existing live console output.
2. Normalize results and save them in the active project's local history location with atomic writes and bounded retention.
3. Preserve the existing history summary fields and APIs so current dashboard/history/MCP consumers continue to work.
4. Return a clear error or partial-run status if structured output is missing or invalid; never silently mark an incomplete run as successful.

**Exit criteria:** a completed run can be read back with exact per-test outcomes; interrupted/invalid reports are distinguishable; existing aggregate history still renders.

### Phase 2 — Expose details and comparisons

1. Link each run from the results and history surfaces to its per-test details.
2. Add filtering by status, browser project, test file/title, and run time.
3. Add comparison of two runs with clear added/resolved/changed outcome labels.
4. Add rerun-failed controls with user-visible command preview and safe validation.

**Exit criteria:** UI tests cover opening details, filtering, comparing, and rerunning a selected failed test without losing existing history behavior.

### Phase 3 — Connect evidence to diagnosis

1. Show the relevant failure message, source location, and retry result next to each failed/flaky test.
2. Link captured API evidence only when it can be associated with that test/run; label missing associations explicitly.
3. Show the diagnosis category, matching evidence, and suggested next steps, clearly marked as heuristic.
4. Apply redaction before evidence is persisted, returned through MCP, or shown in the UI.

**Exit criteria:** diagnosis never invents missing evidence; redaction is consistent across the dashboard, local files, and MCP responses.

### Phase 4 — Stabilize release and automation

1. Resolve the canonical npm package name, repository URL, CLI binary name, and installation documentation.
2. Add automated checks for result normalization, run/history APIs, and core UI workflows.
3. Add a documented CI example that uploads structured results as a build artifact, without requiring hosted QARP storage.
4. Document supported Node.js/Playwright versions, data retention, and troubleshooting.

**Exit criteria:** a clean install from the documented source works; targeted tests run through a named test script; CI users can retain and download results.

## Acceptance criteria for the MVP

- Every completed QARP-managed run has a structured record with per-test status and selected browser project, or is explicitly marked as lacking a valid report.
- A run detail view can locate a test by file/title and show its status, duration, retry count, and failure details when available.
- A user can compare two runs and see per-test status changes without relying on parsed console text.
- A failure-on-retry-then-pass outcome is identified as flaky; a single failed attempt is not.
- Rerun-failed uses only test paths/projects discovered or validated against the active project and shows the command before execution.
- Existing aggregate history, report links, MCP execution, project switching, and current runner behavior continue to work.
- Sensitive headers and body fields are redacted before persistence and presentation, with a one-click history/traffic clearing path retained.

## Suggested validation approach

- Unit tests for report parsing/normalization, legacy-history compatibility, comparison logic, and redaction.
- Server/API tests for completed, failed, cancelled, malformed, and partial result reports.
- Browser tests for run → results → details → compare → rerun navigation.
- A smoke check against each configured browser project using the existing project discovery.
- A clean install/start check after package metadata and documentation are reconciled.

## Decisions to confirm before implementation

- Should run history remain local to each active project, as it is today, or should this plan include an opt-in shared store?
- What should the default result/traffic retention period be, and should full request/response bodies be disabled by default?
- Should the MVP add only run comparison and flaky evidence, or also include an opt-in CI artifact workflow?
