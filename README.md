# Playwright Automation Hub — Modern Web Frontend

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
const {createRunnerServer} = require("qarp-playwright-automation-hub");

// Starts the UI server and points to their local tests
createRunnerServer({
  port: 9300,
  projectRoot: __dirname,
});
```

> The server will start at `http://localhost:9300` and automatically scan for test files in the `tests/` and `e2e/` directories of the consuming project.

---
