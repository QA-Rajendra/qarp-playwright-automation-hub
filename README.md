# Playwright Automation Hub — Modern Web Frontend

A modern, responsive, production-ready web application built exclusively with **HTML5**, **Tailwind CSS**, and **Vanilla JavaScript (ES6+)**. 

This application provides a rich user interface for running, inspecting, and monitoring Playwright test suites. It refactors the embedded UI code from monolithic runners into a decoupled, clean frontend architecture that communicates with test runner services and backend APIs via standard `fetch()`.

---

## 1. Complete Folder Structure

```text
BestNodeJSProject/
│
├── index.html                  # Main Test Explorer & Runner Dashboard
│
├── pages/
│   ├── results.html            # Test Execution Results & Metrics Dashboard
│   └── history.html            # Execution History & Audit Logs View
│
├── js/
│   ├── config.js               # Global configuration, endpoints, themes, presets
│   ├── api.js                  # Fetch API communication layer & mock simulator
│   ├── theme.js                # Multi-theme engine (9 themes) & typography controls
│   ├── common.js               # Toasts, modals, split-pane resizers, keybindings
│   ├── tree.js                 # Explorer tree rendering, filtering, file selection
│   ├── runner.js               # Project/tag/flag filters, CLI generator, console streaming
│   ├── results.js              # Results analytics, pass-rate progress, report triggers
│   └── history.js              # Audit log viewer, status filter, re-run command router
│
├── assets/
│   ├── css/
│   │   └── custom.css          # Theme CSS custom properties, animations, scrollbars
│   └── img/
│       └── favicon.svg         # Playwright Theater Mask SVG Favicon
│
└── README.md                   # Complete documentation and setup guide
```

---

## 2. Technology Stack

* **HTML5**: Semantic tags, split-pane layout, accessibility attributes.
* **Tailwind CSS**: Utility-first CSS via modern CDN integration with responsive breakpoints (`sm:`, `md:`, `lg:`, `xl:`), dark mode support, and glassmorphic panels.
* **Vanilla JavaScript (ES6+)**: Pure client-side object-oriented and modular JavaScript. Zero frameworks (No React, Angular, Vue, Next.js, Node.js or Express in the frontend codebase).
* **API Communication**: Native `window.fetch()` with `async/await` and fallback mock simulator for offline previewing.

---

## 3. Key Features & Screens

### Screen 1: Test Runner Dashboard (`index.html`)
* **Test Explorer**: Hierarchical folder and file tree (`tests/`, `e2e/`), file search with `/` keyboard shortcut, expand/collapse all, individual test selection, and "Run all" folder buttons.
* **Theme & Typography Engine**: 9 animated themes (`Midnight Cyber`, `Daylight Neo`, `Cyberpunk 2077`, `Synthwave 80s`, `Cosmic Aurora`, `Matrix Code`, `Crimson Red`, `Sunset Glow`, `Pastel Vapor`), Bold/Italic typography modes, and custom color pickers for folders and test specs.
* **Execution Parameters**:
  * Configured projects selector (`chromium`, `firefox`, `webkit`, `Mobile Chrome`, etc.).
  * Quick Tag chips (`@sanity`, `@regression`, `@bvt`, `@smoke`, `@e2e`, regex combinations).
  * CLI execution flags (`--workers=4`, `--headed`, `--debug`, `--ui`, `--reporter=html`, `--trace=on`, etc.).
  * Interactive Timeout duration slider (5,000ms – 120,000ms) with enable/disable toggle.
* **Dynamic CLI Preview**: Live syntax-highlighted command string generation (`npx playwright test ...`).
* **Live Streaming Console Rail**: Draggable splitters, real-time log stream with colored highlights (`pass`, `fail`, `warn`, `info`, `time`, `stack traces`), and cancellation trigger.
* **Hotkeys**:
  * `Ctrl + B` (or `Cmd + B`): Toggle left sidebar
  * `Ctrl + J` (or `Cmd + J`): Toggle right live console
  * `/`: Focus search bar

### Screen 2: Test Results & Metrics (`pages/results.html`)
* **Status Banner**: Immediate visual pass/fail indicator with exit code badge.
* **4 Metric KPI Cards**: Passed, Failed, Skipped, and Total test count.
* **Pass Rate Percentage**: Animated gradient bar with shimmer effects and segmental breakdown.
* **Executed Command Box**: Copyable CLI command with one-click clipboard action.
* **Failures Accordion**: Numbered failure cards with call logs and stack traces.
* **Execution Actions**: One-click launchers for HTML Report (`/show-report`), Allure Report (`/allure-report`), "Run Again", and a 5-second countdown timer with manual pause.

### Screen 3: Execution History & Audit Log (`pages/history.html`)
* **Audit Trail**: Logs of the last 100 test runs with timestamp, duration, command, exit code, and metric breakdown.
* **Filters**: Filter by All, Passed Only, or Failed Only, plus instant text search.
* **Re-run Shortcut**: Instant `Run again` button that redirects to the runner pre-filled with the exact command.
* **Clear History**: Modal confirmation with persistent cleanup.

---

## 4. API Integration & Runner Endpoints

All communication between the frontend and backend runner services is handled in `js/api.js` using `fetch()`:

| HTTP Method | API Endpoint | Description | Request / Response Payload |
|-------------|--------------|-------------|----------------------------|
| `GET` | `/structure` | Fetch folder and test spec file tree | Response: `{ tree: [...], folders: [...] }` |
| `GET` | `/projects` | Fetch configured Playwright projects | Response: `["chromium", "firefox", ...]` |
| `POST` | `/run` | Start test execution job | Request: `{ command: "..." }`<br>Response: `{ id: "jobId" }` |
| `GET` | `/run/:id/poll?offset=N` | Stream live console output | Response: `{ newOutput: "...", offset: N, done: boolean, result: {...} }` |
| `POST` | `/run/:id/cancel` | Terminate running execution | Response: `{ ok: true }` |
| `POST` | `/show-report` | Trigger Playwright HTML report server | Response: `{ url: "http://localhost:9320" }` |
| `POST` | `/allure-report` | Generate and launch Allure report server | Response: `{ url: "http://localhost:9335" }` |
| `GET` | `/history` | Fetch execution history logs | Response: `[ { timestamp, command, passed, failed, code }, ... ]` |
| `POST` | `/history/clear`| Clear all stored execution logs | Response: `{ ok: true }` |

### Built-in Standalone Mock Simulator
If the backend runner server is offline, `js/api.js` automatically activates **Mock Simulation Mode**:
- Streams realistic Playwright test execution logs line-by-line into the live console.
- Displays animated progress and exit code generation.
- Records runs to browser `localStorage` history.
- Enables instant UI evaluation without requiring a Node.js server.

---

## 5. MongoDB / Runner Data Mapping

When integrating test execution metadata into MongoDB through backend APIs, the data schema maps to the UI fields as follows:

```json
{
  "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "command": "npx playwright test tests/Step16_ERPMaster --project=\"chromium\"",
  "suite": "Step16_ERPMaster",
  "targetFile": "tests/Step16_ERPMaster/1_programs.spec.js",
  "passed": 5,
  "failed": 0,
  "skipped": 0,
  "total": 5,
  "passRate": 100,
  "exitCode": 0,
  "failedTests": [],
  "traceRecorded": false,
  "executedBy": "QA Automation Engineer",
  "createdAt": "2026-09-08T12:00:00.000Z",
  "updatedAt": "2026-09-08T12:00:15.000Z"
}
```

* `command` → Populates Command Preview and Command Run box.
* `passed`, `failed`, `skipped`, `total` → Populates KPI Stat Cards and Progress Distribution.
* `exitCode` → Controls banner color (Green `#3fb950` if 0, Red `#f85149` if > 0).
* `failedTests` → Renders failure cards in `pages/results.html`.
* `createdAt` → Formatted as human-readable date in `pages/history.html`.

---

## 6. Setup & Running Instructions

### Option A: Static Preview in Any Web Browser (No Node Server Required)
Because the frontend is 100% static HTML, Tailwind CSS, and Vanilla JavaScript:
1. Double-click `index.html` to open it directly in your browser (Google Chrome, Edge, Safari, Firefox).
2. Or serve it with any lightweight HTTP server:
   ```bash
   # Python 3
   python -m http.server 8080

   # Or VS Code Live Server extension
   # Right-click index.html -> "Open with Live Server"
   ```
3. The UI will run in **Demo Simulation Mode** and allow full interaction with all themes, test selection, tag filtering, live console streaming, and results.

### Option B: Connecting to the Playwright Runner Service
1. Start your test runner backend service on port `9300` (or `9301-9303`):
   ```bash
   node runner-server.js
   ```
2. Open `index.html` in your browser.
3. Click the **⚙ API: 9300** badge in the top navigation bar to configure the target runner URL if running on a custom port.

---

## 7. Verification & Testing Guide

| Feature | How to Test | Expected Outcome |
|---------|-------------|------------------|
| **Test Explorer** | Click folders in sidebar or type `/` and enter `finalcourses` | Folder expands/collapses smoothly; search filters to matching spec files. |
| **Command Preview** | Click any spec file and select `@sanity` chip or `--headed` | The CLI preview box immediately updates syntax-highlighted tokens. |
| **Live Console** | Click `▶ Run Tests + Show Report` | Console opens, status switches to `running`, color-coded logs stream line-by-line. |
| **Panel Resizing** | Drag splitter between sidebar and main panel; double-click | Sidebar resizes smoothly; double-clicking restores default 280px width. |
| **Hotkeys** | Press `Ctrl + B` or `Ctrl + J` | Left sidebar or right console toggles open/closed instantly. |
| **Theme Engine** | Click theme button and pick `Cyberpunk 2077` or `Pastel Vapor` | Entire UI palette and glowing background animations update and persist. |
| **Results View** | Wait for test completion or navigate to `pages/results.html` | Shimmer progress bar animates to pass percentage; metrics pop in. |
| **History Log** | Open `pages/history.html` and click `🔁 Run again` | Redirects back to runner dashboard with pre-filled test command. |

---

## 8. Using as an npm Dependency (GitHub Package)

Once pushed to GitHub, any developer or teammate anywhere in the world can install `qarp-playwright-automation-hub` in their own project in one step.

### Step 1: Install the Package

**Option A — One-line install command**

In their terminal:

```bash
npm install github:QA-Rajendra/qarp-playwright-automation-hub
```

**Option B — Add to `package.json` directly**

Add the following to their project's `dependencies` or `devDependencies`:

```json
{
  "name": "any-other-project",
  "version": "1.0.0",
  "dependencies": {
    "qarp-playwright-automation-hub": "github:QA-Rajendra/qarp-playwright-automation-hub"
  },
  "scripts": {
    "test:ui": "playwright-hub"
  }
}
```

Then run:

```bash
npm install
```

---

### Step 2: Run It Once Installed

Once installed in their project, they have **3 ways** to launch the Playwright Automation Hub:

**1. From Terminal (via npx):**

```bash
npx playwright-hub
```

**2. Via npm script:**

```bash
npm run test:ui
```

**3. Programmatically in Node.js / Express:**

```javascript
const { createRunnerServer } = require('qarp-playwright-automation-hub');

// Starts the UI server and points to their local tests
createRunnerServer({
  port: 9300,
  projectRoot: __dirname
});
```

> The server will start at `http://localhost:9300` and automatically scan for test files in the `tests/` and `e2e/` directories of the consuming project.

---
