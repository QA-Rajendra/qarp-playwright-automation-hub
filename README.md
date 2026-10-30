# Playwright Automation Hub — Modern Web Frontend

## 8. Using as an npm Dependency

The package is distributed directly from GitHub. Install it into your project as a dependency:

```bash
npm install github:QA-Rajendra/qarp-playwright-automation-hub
```

Once installed, you can launch the Playwright Automation Hub directly from your project terminal with:

```bash
npx qarp-playwright-automation-hub
```
*(Alias `npx qarp-uiPlaywrightTool` is also supported)*

### Step 1: Install the Package

**Option A — One-line install command**

In your project terminal:

```bash
npm install github:QA-Rajendra/qarp-playwright-automation-hub
```

**Option B — Add to `package.json` directly**

Add the following to your project's `dependencies` or `devDependencies`:

```json
{
  "dependencies": {
    "qarp-playwright-automation-hub": "github:QA-Rajendra/qarp-playwright-automation-hub"
  },
  "scripts": {
    "test:ui": "qarp-playwright-automation-hub"
  }
}
```

Then run:

```bash
npm install
```

---

### Step 2: Run It Once Installed

Once installed in your project, you have **4 ways** to launch the Playwright Automation Hub:

**1. From Terminal (via npx):**

```bash
npx qarp-playwright-automation-hub
```
> ⚡ **Auto-Cleanup & Launch Features:**
> - **Auto-closes old port:** Automatically terminates any lingering process occupying port 9300 (or report/allure ports).
> - **Auto-closes old port browsers:** Closes lingering browser instances/processes specifically associated with the local run port (leaves all your personal browser windows untouched).
> - **Auto-opens new browser:** Automatically launches a fresh browser window directly at `http://localhost:9300`.
> - **Optional Flags:** `--port=<port>`, `--no-open`, `--no-browser-close`, `--close-all-browsers`, `--no-kill-port`, `--lan` (trusted LAN only).


**2. Via npm script:**

```bash
npm run test:ui
```

**3. Programmatically as a standalone server:**

```javascript
const {createRunnerServer} = require("qarp-playwright-automation-hub");

// Starts the UI server and points to their local tests
createRunnerServer({
  port: 9300,
  projectRoot: __dirname,
});
```

> The server will start at `http://localhost:9300` and automatically scan for test files in the `tests/` and `e2e/` directories of the consuming project.

**4. Mount the complete UI and API under Express/Connect:**

```javascript
const express = require("express");
const {runnerMiddleware} = require("qarp-playwright-automation-hub");

const app = express();
const runner = runnerMiddleware({projectRoot: __dirname});
app.use("/test-runner", runner);

const server = app.listen(3000);
server.on("close", () => runner.close());
```

Mount the middleware before a catch-all static handler. It serves the dashboard and runner API below the mount path and rewrites same-origin API calls for that prefix.

### Network access

The CLI and programmatic server bind to loopback by default. To expose the dashboard to a trusted LAN intentionally, start it with `npm start -- --lan` or pass both a non-loopback `host` and `allowLan: true` to `createRunnerServer`. LAN mode has no authentication; do not expose it to the public internet or an untrusted network. Browser cross-origin access is denied by default; standalone server integrations may allow specific exact origins with `corsOrigins: ["https://trusted.example"]`.

---

## Analyze a JavaScript App with REA

QARP includes a REA analyzer for JavaScript application folders and Electron `.asar` bundles:

1. Start QARP with `npm start` and open the dashboard.
2. In the left navigation, select **REA JS Analyzer**.
3. Enter a path relative to the active project root (for example `dist` or `release/app.asar`), then select **Analyze with REA**.
4. Review the output in the page. The first run uses npm to download the pinned `rea-agents@6.7.0` CLI package.

For AI assistants connected to QARP MCP, call `analyze_javascript_application` with a relative `path`. Both the page and MCP tool only accept targets inside the active project root. QARP returns the REA CLI output; the JavaScript analysis itself is performed by REA.

## Scan the Active Project

Open **Project Analyzer** from the dashboard navigation and select **Scan active project**. First, make sure QARP's active project is the project you want to inspect (use the project switcher if needed). It inventories the active project’s folders, file extensions/languages, package manifests, recognized frameworks and tools, Playwright configuration paths, and browser projects. Framework rows show the declared version and, when available, the resolved version from the root `package-lock.json`.

The scan is read-only. It does not open source file contents or `.env` secrets, and skips dependency, generated-output, and version-control folders. It is bounded to 30,000 filesystem entries, 16 directory levels, and 100 `package.json` manifests. The results describe the active project on disk; your attached Seratek demo document is descriptive reference material and is not treated as the active source project. Its example project root is `E:\qaraj\Testsuite`, which you can select as the active project before scanning if that folder exists on this machine.

Connected AI assistants can request the same inventory with the QARP MCP tool `get_project_analysis`.

## Code Optimization Advisor

Open **Code Optimization Advisor** from the dashboard navigation and select **Scan active project**. It reads JavaScript and TypeScript source files under the active project root, then presents suggestions that can be filtered by priority and category. The initial checks flag fixed Playwright waits, DOM-structure-dependent Playwright selectors, and test files longer than 300 lines.

The advisor is local-only and read-only: it does not accept a filesystem path, execute project code, or change files. It skips common dependency/generated/version-control folders, symbolic links, and paths matched by root or nested `.gitignore` and `.qarpignore` files using common glob patterns (`*`, `?`, `**`, and leading `!`). A scan is bounded to 30,000 directory entries, 16 directory levels, 2,000 source files, 256 KB per source file, a 10-second budget checked between filesystem operations, 64 KB per ignore file, and 1,000 findings; skipped or truncated content is reported as a scan note. A single filesystem operation may take longer than the time budget. Each finding includes its rule ID, category, priority, project-relative file and line, short evidence excerpt, recommendation, and heuristic confidence.

These are static-analysis suggestions, not guaranteed defects or measured performance improvements. Review them manually, then verify code changes with the project's tests and benchmarks.

## Test Case Generator

Open **Test Case Generator** from the dashboard Quick Links to model a screen's controls, rules, and validation messages. Filter the 124-control built-in catalog across eight categories or search by name, add individual fields or the visible catalog set, and load login/registration examples. For each field, configure its type, required state, min/max or option rules, and required/invalid error messages.

Add IF/ELSE conditions between fields using AND/OR rules, actions, targets, and apply timing. Generate eight test-design techniques per field (positive, boundary, negative, equivalence partitioning, decision table, state transition, error guessing, and use case), plus condition cases for IF/ELSE rules. **Generate decision table matrix** separately to create the full Cartesian product of Valid, Invalid, and Empty states across the form's input controls (for example, three fields produce 27 rows). Required and invalid rules determine expected validation messages; optional empty fields are treated as valid. Buttons and hidden controls are excluded from the matrix. The matrix is bounded by the overall 5,000-case limit and reports when the combination count is too large. Results appear in a compact table with ID, field, scenario, input, expected result, IF/ELSE condition, and type, with live totals by type. Field rules are validated before generation; changing a field or condition marks existing cases stale and disables export until they are regenerated. Filter generated tests by technique, edit or remove cases, and export CSV or versioned JSON with the control definitions and conditions included. CSV escapes cell syntax and protects spreadsheet formula-like values. Drafts are stored only in this browser's local storage; use **Reset draft** to clear them. Storage and validation failures are shown explicitly. These are suggested test cases, not executed tests.

The **Live preview** panel renders the current form controls and evaluates IF/ELSE actions without submitting to or changing an application. Conditions can run on page load (against the initial preview values), after field changes, or when a preview button is clicked. Use **Reset preview** to clear preview inputs and restore page-load behavior. **Copy all as CSV** copies the current, non-stale generated cases when browser clipboard access is available.

## Record a Website Walkthrough

1. Open **Walkthrough Recorder** from the dashboard navigation.
2. Enter an HTTP or HTTPS URL and select **Start recording**. Puppeteer opens a separate visible browser window.
3. Choose **Headful** to show the browser or **Headless** to run it in the background. In headless mode, use the page controls to query selectors, click elements, fill fields, and submit forms. The same controls are available while the visible browser is open.
4. Download a full-page PNG screenshot or A4 PDF at any time, or select **Finish and generate walkthrough** to close the browser and create a Markdown report.

The recorder is based on [Puppeteer](https://github.com/puppeteer/puppeteer) and requires Node.js 22.12 or newer. It keeps at most 200 actions and does not save filled values or passwords. DOM queries, 2× full-page screenshots, and A4 PDFs can contain page content. Browsing and downloads run on the same computer as the QARP server; use the recorder only on websites you are authorized to access. The default mode for programmatic server integrations can be set with `walkthroughHeadless: true` in `createRunnerServer` options.

If the Puppeteer browser was not downloaded during dependency installation, install it from the project directory with:

```bash
npx puppeteer browsers install chrome
```

## Capture Browser Scenario Evidence

The MCP Inspector's **Browser Scenario Evidence** control runs a local, headless Playwright browser against the supplied HTTP(S) URL and records page title, uncaught page errors, a screenshot, and a video. Scenario notes are not stored, sent to an AI service, or executed as clicks/assertions. Playwright and the selected browser binary must be installed in the active project. Runs are limited to 90 seconds; generated evidence is stored under `.qarp-scenario-runs/` and ignored by Git. This endpoint is local-dashboard-only.

### Application themes

The theme picker provides **Default** and **Sage Slate**, with Sage Slate selected by default. Sage Slate uses `#202734` and `#36415A` for its slate surfaces, with `#B7D894` and `#E0F8C7` as the green accent and highlight colors. Previously saved Default and Blue theme preferences are migrated to Sage Slate once; future theme choices are remembered.

### Git Workflow

Select **Git Workflow** in the dashboard's Quick Links to inspect the active project's current branch, staged and unstaged changes, untracked files, locally known upstream divergence, recent commits, and recent stashes. The page is read-only: it does not fetch, stage, commit, pull, push, switch branches, or modify files. Ahead/behind counts use local tracking data and may be stale until fetched outside the page.

### Quick start

```bash
npm install
npm start
```

Open **Walkthrough Recorder** in the QARP sidebar, enter a URL, pick headful or headless mode, and start a session. Use the DOM tools to inspect or interact with elements, then download a screenshot/PDF or generate a Markdown walkthrough.

## Run QARP validation

```bash
npm run test:unit
npm run test:e2e -- --project=chromium
```

`npm run test:unit` runs the deterministic Node.js unit and runner-middleware tests. `npm run test:e2e` runs the local QARP browser flows using `playwright.e2e.config.js`; it requires the matching Playwright browser binaries. The E2E suite uses an ephemeral loopback runner and local scenario fixture, with no public-site dependency. Run all configured browser projects with `npm run test:e2e`; `npm test` runs both the unit and cross-browser E2E suites.

## Explore the QA Learning Roadmap

Open **QA Level 0–8 Roadmap** from the dashboard's Quick Links. The `pages/qa-roadmap.html` page presents nine levels of QA tools, with Level 8 at the top and Level 0 at the bottom. It uses the shared QARP theme, supports editable tool notes and user-added tools, and stores text edits in browser local storage and PDF notes in IndexedDB. PDF preview uses the pinned pdf.js 3.11.174 script from cdnjs and requires a connection to that CDN. The roadmap's starter tool list and notes are editable in the `ROADMAP_DATA` object near the top of the page's inline script.

## Inspect and Compare Test Runs

QARP records structured per-test results for runs started from its dashboard or MCP tools when the active project has a Playwright config and does not specify a custom `--config` command option. The Results page shows each test's project, file, status, duration, retry outcome, and redacted failure message. Select failed tests from one browser project to preview and rerun them; reruns are validated against the active project and configured browser projects.

Structured result files are stored locally under `.qarp-run-results/`, bounded to the latest history window, and removed when execution history is cleared. The History page allows selecting two structured runs to compare per-test status and flaky changes. Older aggregate-only history entries remain readable but cannot provide per-test comparison.

Captured API traffic is stored locally with sensitive headers/fields and common credential patterns redacted. Retention is bounded to 500 records and 5 MB across the traffic files. Clearing API traffic removes the saved traffic data.

For projects with an existing Playwright config reporter, QARP composes its structured reporter with the configured reporters. If a custom `--config` is supplied directly in a run command, structured insights are not enabled for that run, so the custom config behavior is preserved.

## Run Tests Across Browsers

In the Runner view, **Configured Projects** shows the browser projects declared in the active project's `playwright.config`:

- Chromium is selected by default when configured; otherwise, the first configured browser project is selected.
- Choose one or more browser projects to run the selected test only in those browsers.
- Choose **All browsers** to run it in every configured browser project.

The hub's sample `playwright.config.js` includes Chromium, Firefox, and WebKit. Install their browser binaries from the project folder with:

```bash
npx playwright install chromium firefox webkit
```

For another project, add the browser projects you want to use to its Playwright configuration; QARP lists the configured project names automatically. Separate HAR filenames in the sample configuration keep simultaneous browser projects from writing to the same file.

The same selection is used by QARP's AI chat. The `run_tests` MCP tool accepts either one `project` or a `projects` array; omitting both runs all configured projects.

## CDN & Offline Support Policy

- **Core Functionality (100% Offline / Local):**
  - Test discovery, execution, HAR capture, trace viewer, and test results run entirely on local loopback.
  - The Runner Server, MCP protocol server, Git workflow inspector, Optimization Advisor, and Test Case Generator operate completely offline.
- **External CDN Assets (Online on First Load):**
  - **Tailwind CSS:** Loaded from `https://cdn.tailwindcss.com` for rapid modern UI rendering. Browsers cache this after initial load.
  - **Google Fonts:** Inter & JetBrains Mono typography loaded from `fonts.googleapis.com`.
  - **PDF.js (Roadmap page only):** The QA Roadmap document viewer loads `pdf.min.js` and worker from `cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/`.
- If running in an air-gapped or restricted network environment, the UI will fall back to default system typography and basic styling while all test-execution and API capabilities remain fully functional.

## License

This project is open-source software licensed under the [MIT License](LICENSE).

