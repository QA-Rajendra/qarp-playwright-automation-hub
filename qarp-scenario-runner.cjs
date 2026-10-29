'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const SUPPORTED_BROWSERS = new Set(['chromium', 'firefox', 'webkit']);
const MAX_PROMPT_LENGTH = 4000;
const MAX_OUTPUT_LENGTH = 64 * 1024;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

const SCENARIO_SCRIPT = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, webkit } = require('playwright');

(async () => {
  const browserTypes = { chromium, firefox, webkit };
  const browserType = browserTypes[process.env.QARP_SCENARIO_BROWSER];
  if (!browserType) throw new Error('Unsupported browser engine.');

  const outputDir = process.env.QARP_SCENARIO_DIR;
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await browserType.launch({ headless: true });
  let context;
  try {
    context = await browser.newContext({
      recordVideo: { dir: outputDir, size: { width: 1280, height: 800 } }
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => {
      if (pageErrors.length < 20) pageErrors.push(String(error.message || 'Page error').slice(0, 500));
    });

    await page.goto(process.env.QARP_SCENARIO_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    const title = await page.title();
    const finalUrl = page.url();
    const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
    if (screenshot.length > Number(process.env.QARP_SCENARIO_MAX_ARTIFACT_BYTES)) {
      throw new Error('Screenshot exceeds the artifact size limit.');
    }
    fs.writeFileSync(path.join(outputDir, 'screenshot.png'), screenshot);

    const video = page.video();
    await context.close();
    context = null;
    if (video) {
      const videoPath = path.join(outputDir, 'recording.webm');
      await video.saveAs(videoPath);
      if (fs.statSync(videoPath).size > Number(process.env.QARP_SCENARIO_MAX_ARTIFACT_BYTES)) {
        fs.unlinkSync(videoPath);
        throw new Error('Video exceeds the artifact size limit.');
      }
    }

    process.stdout.write(JSON.stringify({
      title,
      finalUrl,
      pageErrors
    }));
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close();
  }
})().catch(error => {
  process.stderr.write(String(error && error.message || 'Scenario failed').slice(0, 2000));
  process.exitCode = 1;
});
`;

function redactScenarioText(value) {
  return String(value || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED]')
    .replace(/\b(Basic)\s+[A-Za-z0-9+/=]+/gi, '$1 [REDACTED]')
    .replace(/([?&](?:access[_-]?token|api[_-]?key|password|passwd|secret|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, MAX_OUTPUT_LENGTH);
}

function validateScenarioInput(input = {}) {
  const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
  if (!rawUrl || rawUrl.length > 2048) {
    throw Object.assign(new Error('Enter a website URL up to 2,048 characters long.'), { statusCode: 400 });
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('Enter a valid absolute HTTP or HTTPS URL.'), { statusCode: 400 });
  }
  if (!['http:', 'https:'].includes(targetUrl.protocol) || targetUrl.username || targetUrl.password) {
    throw Object.assign(new Error('Only HTTP or HTTPS URLs without embedded credentials are supported.'), { statusCode: 400 });
  }

  const browser = typeof input.browser === 'string' ? input.browser : 'chromium';
  if (!SUPPORTED_BROWSERS.has(browser)) {
    throw Object.assign(new Error('Browser must be chromium, firefox, or webkit.'), { statusCode: 400 });
  }

  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    throw Object.assign(new Error(`Enter scenario notes up to ${MAX_PROMPT_LENGTH} characters long.`), { statusCode: 400 });
  }

  return {
    url: targetUrl.toString(),
    browser,
    prompt: redactScenarioText(prompt)
  };
}

function startScenario(projectRoot, input) {
  const id = crypto.randomUUID();
  const scenarioRoot = path.resolve(projectRoot, '.qarp-scenario-runs');
  fs.mkdirSync(scenarioRoot, { recursive: true });
  const scenarioRootStat = fs.lstatSync(scenarioRoot);
  if (!scenarioRootStat.isDirectory() || scenarioRootStat.isSymbolicLink()) {
    throw new Error('Scenario output path must be a regular directory inside the active project.');
  }
  const outputDir = path.join(scenarioRoot, id);
  fs.mkdirSync(outputDir);
  const job = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    input: { url: redactScenarioText(input.url), browser: input.browser },
    outputDir,
    report: null,
    error: null,
    proc: null
  };

  const proc = spawn(process.execPath, ['-e', SCENARIO_SCRIPT], {
    cwd: projectRoot,
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      QARP_SCENARIO_URL: input.url,
      QARP_SCENARIO_BROWSER: input.browser,
      QARP_SCENARIO_DIR: outputDir,
      QARP_SCENARIO_MAX_ARTIFACT_BYTES: String(MAX_ARTIFACT_BYTES)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  job.proc = proc;
  const timeout = setTimeout(() => {
    if (job.status !== 'running') return;
    job.status = 'failed';
    job.error = 'Scenario exceeded the 90-second execution limit.';
    job.completedAt = new Date().toISOString();
    proc.kill();
  }, 90_000);

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', chunk => {
    if (stdout.length < MAX_OUTPUT_LENGTH) stdout += chunk.toString().slice(0, MAX_OUTPUT_LENGTH - stdout.length);
  });
  proc.stderr.on('data', chunk => {
    if (stderr.length < MAX_OUTPUT_LENGTH) stderr += chunk.toString().slice(0, MAX_OUTPUT_LENGTH - stderr.length);
  });
  proc.on('error', error => {
    clearTimeout(timeout);
    job.status = 'failed';
    job.error = redactScenarioText(error.message);
    job.completedAt = new Date().toISOString();
    job.proc = null;
  });
  proc.on('close', code => {
    clearTimeout(timeout);
    if (job.status !== 'running') return;
    job.status = code === 0 ? 'completed' : 'failed';
    job.completedAt = new Date().toISOString();
    job.proc = null;
    if (code === 0) {
      try {
        job.report = JSON.parse(stdout);
        job.report.finalUrl = redactScenarioText(job.report.finalUrl);
        job.report.pageErrors = Array.isArray(job.report.pageErrors)
          ? job.report.pageErrors.map(redactScenarioText)
          : [];
      } catch {
        job.status = 'failed';
        job.error = 'Scenario process returned an invalid report.';
      }
    } else {
      job.error = redactScenarioText(stderr || `Scenario process exited with code ${code}.`);
    }
  });

  return job;
}

function getScenarioArtifact(job, type) {
  const fileName = type === 'screenshot' ? 'screenshot.png'
    : type === 'video' ? 'recording.webm'
      : null;
  if (!fileName) {
    throw Object.assign(new Error('Artifact type must be screenshot or video.'), { statusCode: 400 });
  }
  const outputDir = path.resolve(job.outputDir);
  if (!fs.existsSync(outputDir) || fs.lstatSync(outputDir).isSymbolicLink()) {
    throw Object.assign(new Error('The requested scenario artifact is not available.'), { statusCode: 404 });
  }
  const filePath = path.resolve(outputDir, fileName);
  if (!filePath.startsWith(`${outputDir}${path.sep}`) || !fs.existsSync(filePath)) {
    throw Object.assign(new Error('The requested scenario artifact is not available.'), { statusCode: 404 });
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARTIFACT_BYTES) {
    throw Object.assign(new Error('The requested scenario artifact is unavailable or exceeds the size limit.'), { statusCode: 413 });
  }
  return {
    filePath,
    size: stat.size,
    contentType: type === 'screenshot' ? 'image/png' : 'video/webm'
  };
}

module.exports = {
  getScenarioArtifact,
  redactScenarioText,
  startScenario,
  validateScenarioInput,
  MAX_ARTIFACT_BYTES
};
