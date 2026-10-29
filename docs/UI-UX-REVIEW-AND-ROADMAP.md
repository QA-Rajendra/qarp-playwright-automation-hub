# QARP UI/UX and Functionality Review

## Scope and limits

This review covers the available QARP source, dashboard navigation, shared theme behavior, current API/error conventions, and the newly added QA roadmap flow. The supplied `QA Roadmap_ Level 0 to 8.html` was not accessible in the workspace, so the starter roadmap is a generic editable baseline and should be reconciled with that reference when it becomes available. This is a source review plus targeted local Chromium checks, not a full usability study with end users.

## Findings

### Improvements delivered

- Added a standalone **QA Level 0–8 Roadmap** page, linked from dashboard Quick Links, with responsive level cards, progress summaries, search, status filtering, and clear saved/unsaved state.
- Made data entry simple through an action editor: choose a level, enter title and outcome, assign owner/date, set status, then save.
- Kept the content in a human-editable JSON file (`data/qa-roadmap.json`), with JSON export, reload, and discard controls. The page uses a local-only validated API and never accepts arbitrary file paths from the browser.
- Used safe DOM text APIs for user-supplied roadmap content, semantic labels/status messaging, keyboard-accessible native form controls, mobile layouts, and reduced-motion support.
- Added a truthful source path/help hint, with no database or external service required.

### Broader QARP usability opportunities

1. Make API connectivity and simulated/offline results unmistakably distinct; avoid success-shaped fallback data where users expect live results.
2. Extend shared theme and navigation behavior to standalone tools that currently use page-specific palettes or have no shared theme controller.
3. Standardize loading, empty, retry, and failure states across pages and preserve useful server error details.
4. Make page descriptions, controls, status messages, and back links consistent across tool pages; ensure responsive and keyboard-only checks cover every major flow.
5. Continue measuring integration reliability before undertaking a large visual redesign or splitting the runner.

## Roadmap page behavior

- Starter file: `data/qa-roadmap.json`
- Read/write API: `GET` and `PUT /api/qa-roadmap`
- Schema: version 1, exactly nine ordered levels (0–8), with validated action fields/statuses and bounded text sizes.
- Save behavior: validate and write a normalized JSON document through a temporary file before replacing the roadmap.
- Data entry: page edits remain a browser draft until **Save roadmap** is selected. **Discard changes** restores the last loaded/saved snapshot; **Reload JSON** fetches the latest file contents, including edits made in a text editor.
- Security boundary: endpoint is intended for loopback/local QARP dashboard requests. It is not a shared team service or an authenticated LAN feature.

## Follow-up plan

1. Provide the original roadmap HTML or its text and reconcile the generic starter levels against the authoritative content.
2. Run the new roadmap store/API unit tests through `npm run test:unit` after the Windows terminal sandbox permits Node/npm execution. The local Chromium editor flow, including JSON save/read-back/delete, has already passed.
3. Review the roadmap with the user and adjust labels, level definitions, ownership fields, and any domain-specific acceptance criteria.
4. Select one representative existing standalone page and align its theme, back navigation, loading/error states, and mobile layout with the shared QARP pattern.
5. Improve mock/offline status messaging and add behavior tests for both live and unavailable API modes.
6. Expand keyboard and viewport checks to the primary dashboard and linked tools; run Chromium first and then Firefox/WebKit when installed.

## Current validation

- Source diagnostics: no errors reported for the touched page, server, test, and documentation files.
- Chromium E2E: 4 tests passed, including roadmap create/save/read-back/delete. VS Code's test runner did not expose a process exit code.
- The roadmap Node unit test was discovered but the VS Code test runner executed zero tests. The canonical `npm run test:unit` still needs a terminal-enabled environment.
- Firefox/WebKit, clean install/package, and documented CLI validation remain unverified. Do not treat source diagnostics as runtime validation.
