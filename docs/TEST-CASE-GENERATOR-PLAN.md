Code Optimization Advisor# Test Case Generator — Implementation Plan

## Goal

Add a standalone, responsive Test Case Generator to QARP. It should use the existing application theme and offer a clearer, more capable workflow for creating test cases from requirements and test-data combinations.

> **Scope update:** A follow-up screenshot from the user superseded the initial matrix-first page design. The implemented screen now leads with the pictured control editor, field validation rules/messages, IF/ELSE conditions, and test-technique filters. The earlier scenario-matrix generator helpers remain available in the shared module, but are no longer the page's primary workflow.

> **Decision-table update:** The results view now supports a dedicated form-level decision table matrix. It enumerates Valid, Invalid, and Empty states across each non-button, non-hidden input control, reports the evaluated expected outcome for each combination, and enforces the shared 5,000-case limit.

> **Preview update:** The page includes a local live preview for form controls. IF/ELSE actions are evaluated at their selected page-load, field-change, or button-click timing; preview actions do not submit or mutate the application under test. Users can reset the preview and copy all current test cases as CSV.

The supplied `Test Case Generator.html` could not be inspected because it is outside the accessible workspace. This plan therefore defines the feature from the available request rather than claiming exact parity with the reference.

## Assumptions

- “Matrix data” means combining user-entered input fields and their values to create data-driven test scenarios.
- The feature is for authoring and exporting test cases, not executing tests.
- Generated test cases and drafts remain in the browser; no new API, server-side storage, AI service, or external dependency is needed for the initial version.
- The reference HTML may identify additional required behavior when its contents become accessible.

## Requirements

- **REQ-001 — Separate page:** Provide a dedicated Test Case Generator page accessible from QARP Quick Links, without replacing existing runner features.
- **REQ-002 — Same theme and responsive UX:** Reuse QARP’s shared theme and design language, with accessible controls and layouts that work on narrow screens.
- **REQ-003 — Test-case authoring:** Allow the user to enter a feature or requirement, case title/context, preconditions, steps, expected results, and priority/type.
- **REQ-004 — Test-data matrix:** Allow named data columns with multiple values and generate combinations deterministically, with a configurable combination cap and a clear truncation warning.
- **REQ-005 — Review and edit:** Display generated cases in a readable, editable table/list; support removing cases and regenerating from current inputs.
- **REQ-006 — Persistence:** Save and restore drafts and generated cases locally in the browser, with explicit clear/reset behavior.
- **REQ-007 — Export:** Export reviewed cases as CSV and JSON, correctly escaping content and preserving matrix input values.
- **REQ-008 — Validation and states:** Show actionable input validation, generation limits, empty/loading/saved states, and export feedback without silently dropping data.
- **REQ-009 — Safe client rendering:** Treat all user-entered text as data and render it through DOM text APIs; do not inject it as HTML.
- **REQ-010 — Tests and documentation:** Add focused UI/unit coverage and document the feature, generated-combination limit, local persistence, and export formats.

## Scope

### Included

- A new page at `pages/test-case-generator.html`.
- A focused client-side generation module under `js/` if it improves testability; otherwise keep logic small and colocated with the page.
- Editable case templates and matrix inputs.
- Deterministic combination generation with duplicate/empty-value handling and a hard case-count limit.
- Browser-local draft persistence and CSV/JSON downloads.
- Quick Links navigation, README usage guidance, and focused unit/E2E coverage.

### Not included in the first version

- AI-generated test content, external network requests, or server APIs.
- Running generated cases with Playwright.
- Importing arbitrary spreadsheet formats.
- Team collaboration or shared remote persistence.
- Claims of complete behavior parity with the inaccessible reference page.

## UX and data behavior

1. **Setup panel:** User enters a feature/requirement name, objective, preconditions, and reusable test steps/expected result template.
2. **Data matrix:** User adds named columns and comma/newline-separated values. An example matrix may contain `role: admin, viewer` and `browser: chromium, firefox`.
3. **Generation mode:** Default to the full Cartesian product. Show the estimated number of generated cases before generation; do not silently exceed the configured limit. Initial limit: 200 cases.
4. **Generated cases:** Each row includes a stable case ID, title, priority/type, steps, expected result, and its matrix-value mapping. User can edit or remove generated rows.
5. **Regeneration:** Regenerate only after explicit user action. Clearly state that regenerating replaces the current generated set, and require confirmation if edits would be lost.
6. **Persistence:** Save input and case state to a versioned localStorage key. If stored data is malformed, show a recoverable warning and allow a fresh draft instead of crashing.
7. **Exports:** CSV includes stable columns and quotes commas, quotes, and line breaks correctly. JSON exports a versioned envelope containing source template, matrix definition, and cases.
8. **Accessibility:** Use labeled controls, keyboard-operable actions, visible focus, live status messages, and a mobile-friendly card/table layout.

## Implementation plan

### Phase 1 — Shared feature foundation

#### Plan 1.1 — Define the test-case and matrix model (REQ-003, REQ-004, REQ-006, REQ-007)

- Define and document the versioned model for input template, matrix fields, generation metadata, and cases.
- Add pure functions for parsing matrix values, estimating product size, generating deterministic combinations, and validating limits.
- Define stable IDs and an explicit policy for blank, duplicate, or malformed matrix values.
- Keep generation deterministic and independent of browser DOM state.

#### Plan 1.2 — Add bounded persistence and exports (REQ-006, REQ-007, REQ-008)

- Add versioned localStorage load/save/clear helpers with explicit parse and quota errors.
- Add CSV and JSON serialization helpers with unit-testable output.
- Warn before destructive reset or regeneration over edited cases.

### Phase 2 — User Story 1: Create and review cases (P1)

#### Plan 2.1 — Build the generator page and matrix workflow (REQ-001, REQ-002, REQ-003, REQ-004, REQ-008, REQ-009)

- Add `pages/test-case-generator.html` with the shared theme assets and consistent QARP page shell.
- Add the template editor, matrix-column editor, combination estimate, generate action, validation messages, and explicit empty/error states.
- Render generated data safely with text nodes and editable inputs.
- Enforce the 200-case cap and report how many combinations were omitted when the user confirms a capped generation.

#### Plan 2.2 — Add review, edit, save, and export interactions (REQ-005, REQ-006, REQ-007, REQ-008)

- Add editable case fields, remove-case controls, regenerate confirmation, autosave status, and explicit reset confirmation.
- Support CSV and JSON downloads with stable filenames and documented schemas.
- Restore saved drafts on page load and handle invalid or unavailable localStorage with a visible message.

### Phase 3 — Integration, verification, and documentation

#### Plan 3.1 — Integrate dashboard navigation and docs (REQ-001, REQ-002, REQ-010)

- Add a clearly named Test Case Generator Quick Link to `index.html`.
- Document the data-matrix combination behavior, 200-case limit, local-only storage, reset behavior, and export formats in `README.md`.

#### Plan 3.2 — Verify behavior with focused tests (REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010)

- Unit tests cover parsing, Cartesian-product counts, stable combination order, empty/duplicate values, limits, IDs, CSV escaping, JSON shape, and malformed saved state.
- E2E tests cover page navigation, adding matrix columns and values, generating/editing/removing cases, filtering or sorting if included, persistence after reload, exports, validation, limit warnings, and safe rendering of HTML-like input.
- Confirm shared theme behavior and responsive layout with the existing Playwright setup.

## Proposed project structure

```text
index.html
pages/
  test-case-generator.html
js/
  test-case-generator.js       # Optional; use if separating/test-driving pure UI logic
qarp-test-case-generator.cjs   # Optional only if CommonJS pure logic is preferable
tests/
  unit/
    test-case-generator.test.cjs
  e2e/
    test-case-generator.spec.js
README.md
```

Choose one home for the pure model/helpers during implementation; do not create both optional modules without a need. Follow the repository’s existing browser/module and test conventions.

## Risks and decisions

- **Reference parity:** The original HTML was denied by sandbox policy. Feature behavior is inferred. If exact feature parity is required, provide the HTML in the workspace or paste its relevant behavior before implementation.
- **Combination explosion:** Multiple matrix columns can grow combinatorially. Preview the count and enforce the 200-case cap before allocating generated rows.
- **Draft loss:** Regeneration, reset, and localStorage quota/parse errors must be explicit; avoid silently overwriting unsaved user edits.
- **CSV injection:** Escape CSV syntax and neutralize spreadsheet formula prefixes in exported user-controlled cell values.
- **Storage size:** Keep the case cap and consider a serialized draft-size limit; surface storage failures rather than pretending a save succeeded.

## Acceptance criteria

1. The feature is separate from the runner and reachable from Quick Links.
2. It inherits the shared QARP theme and is keyboard-usable and responsive.
3. Matrix inputs produce the documented deterministic combinations, with a visible estimate and enforced cap.
4. Cases can be reviewed and edited before exporting.
5. Drafts survive reload where browser storage is available; failures are visible and do not corrupt the page.
6. CSV and JSON exports preserve intended content and handle special characters safely.
7. User-supplied strings never become executable HTML.
8. Focused unit and E2E tests cover the core flows and limit/error behavior.
9. Documentation accurately states local-only storage, export formats, and the generation cap.

## Task breakdown

### Phase 1 — Foundation

- [x] T001 [Plan:1.1] Define the versioned test-case, template, and matrix data contract in the selected test-case generator module.
- [x] T002 [Plan:1.1] Implement pure matrix parsing, combination estimation/generation, validation, and stable case identifiers.
- [x] T003 [Plan:1.2] Implement local draft persistence with schema versioning and explicit malformed/quota error results.
- [x] T004 [Plan:1.2] Implement CSV-safe and versioned JSON export helpers, including spreadsheet formula-prefix protection.

### Phase 2 — User Story 1: Create and review cases

- [x] T005 [US1] [Plan:2.1] Create `pages/test-case-generator.html` using the shared theme and accessible, responsive QARP styling.
- [x] T006 [US1] [Plan:2.1] Implement template inputs, dynamic matrix columns, value editing, combination estimate, validation, and capped generation UI.
- [x] T007 [US1] [Plan:2.2] Implement safe case rendering, case editing/removal, autosave, reload restoration, and destructive-action confirmation.
- [x] T008 [US1] [Plan:2.2] Wire CSV and JSON downloads and present successful/failed export status accessibly.

### Phase 3 — Integration and validation

- [x] T009 [Plan:3.1] Add the Test Case Generator Quick Link to `index.html` and feature guidance to `README.md`.
- [x] T010 [P] [Plan:3.2] Add focused unit coverage in `tests/unit/test-case-generator.test.cjs`.
- [x] T011 [P] [Plan:3.2] Add browser workflow and responsive/theme checks in `tests/e2e/test-case-generator.spec.js`.
- [ ] T012 [Plan:3.2] Run targeted unit and E2E suites; fix regressions and confirm existing runner/roadmap behavior remains intact. **Blocked:** VS Code test discovery executed zero tests, and `npm run test:unit` could not start because the Windows sandbox requires BaseContainer.

## Implementation status

The page, browser-safe generation module, tests, navigation, and documentation are implemented. The unit/E2E suites still need to be executed in an environment where the Windows sandbox supports the workspace.

## Requirement Mapping

| REQ ID | Description | Plan Items | Implementation Evidence |
|--------|-------------|------------|--------------------------|
| REQ-001 | Separate page linked from QARP | 2.1, 3.1 | `pages/test-case-generator.html`, `index.html` |
| REQ-002 | Shared theme and responsive accessible UI | 2.1, 3.1 | `pages/test-case-generator.html`, E2E checks |
| REQ-003 | Author test cases from requirement/template | 1.1, 2.1 | Test-case model and template editor |
| REQ-004 | Generate deterministic data-matrix combinations with cap | 1.1, 2.1 | Matrix model/helpers and generator UI |
| REQ-005 | Review and edit generated cases | 2.2 | Case list/editor interactions |
| REQ-006 | Local draft persistence and reset | 1.2, 2.2 | Persistence helper and reload/reset tests |
| REQ-007 | CSV and JSON exports | 1.2, 2.2 | Serialization helpers and download controls |
| REQ-008 | Validation, status, and explicit limits/errors | 1.2, 2.1, 2.2, 3.2 | Validation states and bounded generation tests |
| REQ-009 | Safe rendering of user-controlled input | 2.1, 3.2 | DOM text-based rendering and injection-string E2E test |
| REQ-010 | Tests and user documentation | 3.1, 3.2 | `README.md`, unit and E2E suites |

## Open follow-up

The screenshot-driven UI is implemented from the available image. The separate HTML reference previously denied by sandbox policy remains uninspected, so exact parity with that file cannot be verified.
