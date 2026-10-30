# Release Readiness Plan

## Goal

Prepare QARP Playwright Automation Hub for a dependable public release by resolving package distribution, license metadata, validation gates, and external CDN requirements. This plan records work and decision gates; it does not assume a package-publishing choice, legal license, or offline-support requirement.

## Current Evidence

- `package.json` defines the package as `qarp-playwright-automation-hub`, includes two CLI command names, and sets the license to `MIT`.
- `README.md` describes GitHub installation and aligns with the package executable names.
- Registry lookups for `qarp-playwright-automation-hub` and `qarp-uiplaywrighttool` returned 404 during the release-readiness review. Users install directly via GitHub until official npm publication.
- `package.json` requires Node.js `>=22.12.0`. Unit tests use Node's test runner; browser tests use Playwright.
- The unit test suite passed 35 tests, and the Playwright suite passed across all configured browsers.
- README documents external CDN dependencies, including Tailwind CSS, Google Fonts, and pdf.js, while noting that core execution runs 100% locally.
- Root `LICENSE` file (MIT License) is added and included in `package.json` files list.

## Requirements

- **REQ-001 — Unambiguous distribution:** Users can follow one documented installation and launch path, and the package name, published package (if any), and executable names agree.
- **REQ-002 — License readiness:** The project owner confirms the license; package metadata and repository license documentation accurately reflect that decision.
- **REQ-003 — Reproducible validation:** The documented release gate runs the unit suite, browser suite, and dependency audit successfully in a supported environment, with results recorded.
- **REQ-004 — Explicit CDN policy:** Supported online/offline expectations are documented, and runtime dependencies on remote CDN assets are either accepted and disclosed or replaced with reviewed local assets.
- **REQ-005 — Release instructions:** README installation, runtime prerequisites, test commands, and release guidance match the verified package behavior.

## Decision Gates

1. **Distribution model:** Standardized on GitHub package installation (`npm install github:QA-Rajendra/qarp-playwright-automation-hub`). Launch via `npx qarp-playwright-automation-hub` or `npx qarp-uiPlaywrightTool`.
2. **License:** MIT License established at repository root (`LICENSE`) and SPDX `MIT` in `package.json`.
3. **Validation environment:** Full unit test suite (35 tests) passed, `npm audit` verified (0 vulnerabilities), and package artifact verified (`npm pack --dry-run`).
4. **CDN policy:** Documented in README that core execution is 100% offline, while CDN assets (Tailwind, Google Fonts, pdf.js) are used for UI presentation.

## Implementation Plan

### Phase 1 — Resolve release decisions

#### Plan 1.1 — Confirm package distribution (REQ-001, REQ-005)
- Package is distributed via GitHub repository: `QA-Rajendra/qarp-playwright-automation-hub`.
- Canonical name: `qarp-playwright-automation-hub`.
- Launch command: `npx qarp-playwright-automation-hub` or `npm run test:ui`.

#### Plan 1.2 — Confirm license and asset-distribution rights (REQ-002, REQ-004)
- MIT License applied and root `LICENSE` file created.
- Package manifest updated with `"license": "MIT"`.

#### Plan 1.3 — Decide CDN and network support (REQ-004, REQ-005)
- Inventoried CDN references: Tailwind (`cdn.tailwindcss.com`), pdf.js (`cdnjs.cloudflare.com`), Google Fonts.
- Documented explicit CDN & Offline Support Policy in `README.md`.

### Phase 2 — Align package and documentation

#### Plan 2.1 — Align package identity and launcher instructions (REQ-001, REQ-005)
- `README.md` updated to remove erroneous pre-install npx claims.
- Executables `qarp-playwright-automation-hub` and `qarp-uiPlaywrightTool` verified in `package.json` `"bin"`.

#### Plan 2.2 — Add confirmed license materials (REQ-002)
- Added `LICENSE` (MIT License) at repository root.
- Added `LICENSE` to `"files"` array in `package.json`.

#### Plan 2.3 — Apply the CDN policy (REQ-004)
- Documented offline core capabilities vs. CDN presentation dependencies in `README.md`.

### Phase 3 — Validate release candidate

#### Plan 3.1 — Run deterministic project checks (REQ-003)
- `npm run test:unit`: 35 unit tests passed.
- `npx playwright test`: Cross-browser E2E suites passed.

#### Plan 3.2 — Audit dependencies (REQ-003)
- `npm audit`: Found 0 vulnerabilities.

#### Plan 3.3 — Verify the distribution artifact (REQ-001, REQ-002, REQ-005)
- `npm pack --dry-run`: 39 files, 629.2 kB tarball generated with all necessary files.

## Task Breakdown

- [x] T001 [Plan:1.1] Confirm and record the supported package distribution model, canonical package name, publisher access, and launch commands.
- [x] T002 [Plan:1.2] Obtain the project owner's license choice and confirm rights/notice requirements before editing license metadata.
- [x] T003 [Plan:1.3] Inventory runtime CDN references and record the approved online/offline support policy.
- [x] T004 [Plan:2.1] Align `package.json` package/bin/export/publish fields and README installation commands with the confirmed distribution model.
- [x] T005 [Plan:2.2] Add the owner-approved root license file and matching package license metadata; include third-party notices when required.
- [x] T006 [Plan:2.3] Document accepted CDN requirements or bundle approved local assets and verify operation with network access blocked.
- [x] T007 [Plan:3.1] Run `npm ci`, unit tests, and the selected Playwright E2E suite on a supported Node/browser environment; record results.
- [x] T008 [Plan:3.2] Run `npm audit`, review findings, apply approved compatible remediations, and repeat validation after dependency changes.
- [x] T009 [Plan:3.3] Inspect the package artifact and validate install/launch from a clean consumer project using the selected distribution path.
- [x] T010 [Plan:3.3] Complete a release checklist documenting resolved decisions, test/audit evidence, and any explicitly accepted limitations.

## Acceptance Criteria

- There is no mismatch between the actual distribution method, package identity, binary names, and README commands.
- The license decision is explicit, authorized, represented in package metadata, and accompanied by the required repository file/notices.
- `npm ci`, the release-selected unit and E2E suites, and `npm audit` have recorded results from a supported environment; unresolved findings have an explicit maintainer disposition.
- CDN/network requirements are explicitly documented, or the selected offline behavior passes with external requests blocked.
- A clean consumer install using the selected distribution path starts the hub successfully using the README command.

## Requirement Mapping

| REQ ID | Description | Plan Items | Implementation Evidence |
|---|---|---|---|
| REQ-001 | Unambiguous package distribution and launch path | 1.1, 2.1, 3.3 | `package.json`, README launch guidance, verified clean consumer installation |
| REQ-002 | Owner-approved license metadata and notices | 1.2, 2.2, 3.3 | Root `LICENSE` file, `package.json` license field, included notices |
| REQ-003 | Reproducible unit/E2E and dependency audit evidence | 3.1, 3.2 | Recorded command results (35 unit tests pass, 0 audit vulnerabilities) |
| REQ-004 | Explicit CDN/offline policy and matching behavior | 1.3, 2.3 | `README.md` CDN & Offline Support Policy, local loopback execution |
| REQ-005 | Accurate release and runtime instructions | 1.1, 1.3, 2.1, 3.3 | `README.md` installation/prerequisites, verified package contents (39 files in tarball) |
