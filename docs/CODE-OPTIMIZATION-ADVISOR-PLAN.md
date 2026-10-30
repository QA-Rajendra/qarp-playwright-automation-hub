# Code Optimization Advisor — Implementation Plan

## Goal

Add a read-only QARP feature that scans an active JavaScript or TypeScript project and presents evidence-based opportunities to improve code maintainability, runtime efficiency, and Playwright test practices. The first release must not modify project files or claim that heuristic findings are guaranteed defects.

## MVP scope

- Analyze JavaScript and TypeScript source files in the active project.
- Start with a small, explainable set of static rules, including:
  - Potentially redundant or repeated work in loops and frequently called code.
  - Unused or duplicated imports where reliable detection is possible.
  - Playwright fixed waits and fragile selector patterns.
  - Large test files or tests with excessive setup that may benefit from decomposition.
- Return findings with rule ID, category, priority, file path, line number, evidence, explanation, recommendation, and confidence.
- Provide a dedicated dashboard page with a scan action, summary, category/priority filters, and clear loading, empty, and error states.
- Reuse QARP active-project selection, existing navigation, and shared theme.
- Keep analysis local and read-only; exclude dependency folders, generated output, version control data, and configured ignore paths.

## Out of scope for the first release

- Automatically rewriting, deleting, or formatting project files.
- Claiming measured runtime improvements from static analysis alone.
- Scanning arbitrary languages or binaries.
- Uploading source code or findings to external services.
- Running project code as part of static analysis.

## Work breakdown

### 1. Define finding and rule contracts

- Create a documented finding schema:
  `ruleId`, `category`, `priority`, `file`, `line`, `evidence`, `summary`, `recommendation`, and `confidence`.
- Define deterministic priority and confidence values.
- Specify how unsupported files and unreadable files are reported.
- Document that static findings are suggestions requiring developer review.

### 2. Implement bounded project inventory and analyzer

- Reuse existing project scanning and skip-pattern behavior where possible.
- Add file-count, file-size, and directory-depth limits consistent with existing project analysis safeguards.
- Read only supported source files and never execute scanned code.
- Implement small, independently testable rules and stable finding ordering.
- Ensure an unreadable or oversized file is reported or skipped explicitly rather than silently treated as clean.

### 3. Add the Optimization Advisor API

- Add a local dashboard endpoint that accepts no arbitrary filesystem path; use the active project root resolved by the server.
- Validate request size and method, bound analysis duration and output count, and return a stable JSON shape.
- Keep error responses explicit and avoid exposing files outside the active project.

### 4. Build the dashboard page

- Add an Optimization Advisor page using existing QARP layout and theme patterns.
- Include a **Scan active project** control, summary counts, and a findings table/list.
- Provide filters for priority and category, plus empty, loading, and error states.
- Escape file paths, source excerpts, and recommendations before rendering.
- Make findings keyboard-accessible and usable on narrow screens.

### 5. Integrate navigation and documentation

- Add a clear entry point from the existing dashboard navigation.
- Document supported languages, scan limits, rules, confidence semantics, and read-only behavior.
- Explain that recommended changes must be reviewed and measured with project tests or benchmarks.

### 6. Validate behavior

- Unit tests:
  - Each rule’s positive and negative cases.
  - Stable ordering and line-number accuracy.
  - Ignore patterns and generated/dependency exclusions.
  - File-size/count limits and unreadable-file behavior.
  - Malformed or unexpected source input.
- API tests:
  - Successful scan and stable response shape.
  - Active-project-only scope.
  - Explicit validation and analysis errors.
  - No file modifications during a scan.
- End-to-end tests:
  - Launch a scan and show findings.
  - Filter findings by priority/category.
  - Show an empty state for a clean fixture.
  - Preserve shared theme and responsive layout.

## Acceptance criteria

1. A scan is local, read-only, bounded, and never executes scanned project code.
2. Every finding has a valid project-relative file path, line number, evidence, explanation, recommendation, and confidence.
3. Repeated scans of unchanged input produce the same findings in the same order.
4. Ignored and generated files do not appear in results.
5. API and UI display failures explicitly; they do not present a failed scan as a successful empty scan.
6. Unit, API, and focused end-to-end tests pass.
7. Documentation describes rule limitations and does not promise unmeasured speed improvements.

## Suggested delivery order

Deliver the schema and one or two reliable Playwright rules first, then the bounded analyzer and API, followed by the dashboard page. Add additional source-code rules only after their accuracy and false-positive behavior are covered by fixtures.
