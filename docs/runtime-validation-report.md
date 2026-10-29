# Runtime Validation Report

**Generated:** 2026-10-29  
**Target:** QARP Playwright Automation Hub repository

## Latest test attempt

On 2026-10-29, attempted `npm run test:unit`, `npm run test:e2e -- --project=chromium`, and `node --version; npm --version; npx playwright --version` in parallel. PowerShell could not start any command because the Windows sandbox reported: `Sandboxing is enabled but not supported on this platform: Windows sandboxing requires BaseContainer.` The tool wrapper exited with code `1`; this is an environment startup failure, not the exit code of npm or a test result. No test counts were produced by these command attempts.

## Summary

| Step | Status | Exit Code | Details |
|---|---|---:|---|
| Startup | PARTIAL | n/a | Playwright worker started the runner via `createRunnerServer` on an ephemeral loopback port and loaded its pages. The documented `npm start` CLI smoke test was not run. |
| Unit Tests | UNVERIFIED | n/a | VS Code test discovery found the selected Node test files but executed zero tests. `npm run test:unit` was not run. |
| Browser E2E | PASS (test-runner result) | Not exposed | Chromium: 3 passed, 0 failed. Result reported by the VS Code test runner; it did not provide a process exit code. Firefox and WebKit were not run. |
| Clean Install / Package | UNVERIFIED | n/a | `npm ci`, `npm pack --dry-run`, and clean consumer install were not run. |

**Overall:** NEEDS_SIGNOFF — Chromium browser flows passed, but the canonical Node unit command, command exit codes, clean install/package checks, CLI startup, and Firefox/WebKit coverage remain unverified.

## Environment

- Node.js and npm versions: not captured; terminal commands are blocked by the Windows sandbox's BaseContainer limitation.
- Docker: not required by the current application architecture; no container-backed database, broker, or other test infrastructure is used.
- Playwright package and Chromium browser: available to the VS Code test runner; the Chromium E2E suite executed.
- Firefox and WebKit browser binaries: not verified or run.
- Browser test network scope: local runner and a local HTTP fixture; external requests are blocked.

## Test Evidence

The following three Playwright tests passed on Chromium through the VS Code test runner:

1. Dashboard navigation visits every packaged local HTML page and exercises the collapsed-by-default Quick Links.
2. Sage is selected on a clean profile, a supported theme selection persists, and MCP Inspector offers Sage rather than Blue.
3. MCP Inspector rejects an invalid scenario URL, submits a local scenario, observes completion, and retrieves screenshot and video artifacts.

The run did not expose a process exit code. The Node-based unit suite was explicitly attempted through VS Code test discovery and reported zero tests executed; this is not a pass. The configured `npm run test:unit` command still needs to be run in a terminal-enabled environment.

## Issues Found and Changes Made

- The dashboard initialized Quick Links as expanded even though the control markup declares the collapsed state. Changed startup initialization to collapsed and added E2E coverage.
- MCP Inspector described scenario notes as saved although the runner does not persist them. Corrected the UI copy.
- Added local-only browser smoke tests and separate Playwright discovery so the browser suite does not collect Node unit files.

## Remaining Validation

- Run `npm ci`, `npm run test:unit`, and `npm run test:e2e -- --project=chromium`; record each command's exit code and test counts.
- Install and execute Firefox and WebKit projects independently where browser installation succeeds.
- Run `npm start` and validate the documented CLI readiness/shutdown behavior.
- Run package-content and clean-consumer-install checks.
- Complete the remaining Git Workflow scenario matrix and verify generated files are cleaned or ignored.
