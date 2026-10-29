'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const COMMAND_TIMEOUT_MS = 5000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_CHANGED_FILES = 300;
const MAX_COMMITS = 5;
const MAX_STASHES = 6;

function redactGitText(value) {
  return String(value || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED]')
    .replace(/\b(Basic)\s+[A-Za-z0-9+/=]+/gi, '$1 [REDACTED]')
    .replace(/\b(set-cookie|cookie)\s*:\s*[^\r\n]+/gi, '$1: [REDACTED]')
    .replace(/([?&](?:access[_-]?token|api[_-]?key|password|passwd|secret|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|secret|token|api[-_]?key|authorization)\s*[:=]\s*)["']?[^&\s"',;]+/gi, '$1[REDACTED]');
}

function runGit(projectRoot, args) {
  const gitArgs = [
    '--no-pager',
    '-c', 'core.fsmonitor=false',
    '--no-optional-locks',
    ...args
  ];

  return new Promise((resolve, reject) => {
    execFile('git', gitArgs, {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.fsmonitor',
        GIT_CONFIG_VALUE_0: 'false'
      }
    }, (error, stdout, stderr) => {
      if (error) {
        error.gitStderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function classifyFileStatus(indexStatus, worktreeStatus) {
  const status = `${indexStatus}${worktreeStatus}`;
  if (status.includes('U') || status === 'AA' || status === 'DD') return 'conflicted';
  if (status.includes('R')) return 'renamed';
  if (status.includes('C')) return 'copied';
  if (status.includes('A') || status === '??') return 'added';
  if (status.includes('D')) return 'deleted';
  if (status.includes('M')) return 'modified';
  if (status.includes('T')) return 'type changed';
  return 'changed';
}

function parsePorcelainStatus(output, maxFiles = MAX_CHANGED_FILES) {
  const staged = [];
  const unstaged = [];
  const untracked = [];
  const records = String(output).split('\0');
  let totalFiles = 0;

  for (let index = 0; index < records.length - 1; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;

    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const filePath = record.slice(3);
    const isUntracked = indexStatus === '?' && worktreeStatus === '?';

    if (indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') {
      index += 1;
    }

    totalFiles += 1;
    if (totalFiles > maxFiles) continue;

    const change = {
      path: filePath,
      type: classifyFileStatus(indexStatus, worktreeStatus),
      status: `${indexStatus}${worktreeStatus}`
    };

    if (isUntracked) {
      untracked.push(change);
      continue;
    }
    if (indexStatus !== ' ') staged.push(change);
    if (worktreeStatus !== ' ') unstaged.push(change);
  }

  return {
    staged,
    unstaged,
    untracked,
    totalFiles,
    truncated: totalFiles > maxFiles
  };
}

function parseDelimitedRecords(output, fields) {
  return String(output).trim().split('\n').filter(Boolean).map(line => {
    const values = line.split('\x1f');
    return Object.fromEntries(fields.map((field, index) => [field, values[index] || '']));
  });
}

function isNotRepository(error) {
  return Number(error.code) === 128 && /not a git repository/i.test(error.gitStderr || error.message);
}

function isUnbornHead(error) {
  return Number(error.code) === 128 && /does not have any commits yet/i.test(error.gitStderr || error.message);
}

function isDetachedHead(error) {
  return Number(error.code) === 1 && /not a symbolic ref/i.test(error.gitStderr || error.message);
}

function hasNoUpstream(error) {
  return Number(error.code) === 128 && /no upstream configured/i.test(error.gitStderr || error.message);
}

async function getGitStatus(projectRoot) {
  const activeProject = path.resolve(projectRoot);
  let projectStat;
  try {
    projectStat = fs.statSync(activeProject);
  } catch {
    const error = new Error('The active project directory does not exist or cannot be accessed.');
    error.code = 'GIT_PROJECT_UNAVAILABLE';
    throw error;
  }
  if (!projectStat.isDirectory()) {
    const error = new Error('The active project path is not a directory.');
    error.code = 'GIT_PROJECT_UNAVAILABLE';
    throw error;
  }

  let repositoryRoot;
  try {
    repositoryRoot = (await runGit(activeProject, ['rev-parse', '--show-toplevel'])).trim();
  } catch (error) {
    if (isNotRepository(error)) {
      return {
        repository: false,
        activeProject,
        checkedAt: new Date().toISOString()
      };
    }
    if (error.code === 'ENOENT') {
      error.code = 'GIT_UNAVAILABLE';
      error.message = 'Git is not installed or is not available on the server PATH.';
    } else if (error.killed || error.code === 'ETIMEDOUT') {
      error.code = 'GIT_TIMEOUT';
      error.message = 'Git status inspection timed out.';
    } else {
      error.code = 'GIT_STATUS_FAILED';
      error.message = 'Could not inspect the active project Git repository.';
    }
    throw error;
  }

  const branchResult = await runGit(activeProject, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    .then(branch => ({ branch: branch.trim(), detached: false }))
    .catch(async error => {
      if (!isDetachedHead(error)) throw error;
      const head = (await runGit(activeProject, ['rev-parse', '--short', 'HEAD'])).trim();
      return { branch: null, head, detached: true };
    });

  const statusOutput = await runGit(activeProject, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const changes = parsePorcelainStatus(statusOutput);

  let commits = [];
  try {
    commits = parseDelimitedRecords(
      await runGit(activeProject, ['log', `-${MAX_COMMITS}`, '--format=%H%x1f%s%x1f%an%x1f%aI']),
      ['hash', 'subject', 'author', 'date']
    ).map(commit => ({ ...commit, subject: redactGitText(commit.subject) }));
  } catch (error) {
    if (!isUnbornHead(error)) throw error;
  }

  const upstreamResult = branchResult.detached
    ? { upstream: null, available: false }
    : await runGit(activeProject, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
      .then(upstream => ({ upstream: upstream.trim(), available: true }))
      .catch(error => {
        if (hasNoUpstream(error)) return { upstream: null, available: false };
        throw error;
      });

  let divergence = null;
  if (upstreamResult.available && commits.length > 0) {
    const counts = (await runGit(activeProject, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])).trim().split(/\s+/);
    if (counts.length !== 2 || counts.some(value => !/^\d+$/.test(value))) {
      const error = new Error('Git returned an invalid upstream divergence count.');
      error.code = 'GIT_STATUS_FAILED';
      throw error;
    }
    divergence = { behind: Number(counts[0]), ahead: Number(counts[1]) };
  }

  const stashRecords = parseDelimitedRecords(
    await runGit(activeProject, ['stash', 'list', '-n', String(MAX_STASHES), '--format=%gd%x1f%s%x1f%ci']),
    ['reference', 'subject', 'date']
  ).map(stash => ({ ...stash, subject: redactGitText(stash.subject) }));

  return {
    repository: true,
    activeProject,
    repositoryRoot: repositoryRoot.trim(),
    branch: branchResult.branch,
    head: branchResult.head || null,
    detached: branchResult.detached,
    changes,
    upstream: upstreamResult.upstream,
    divergence,
    upstreamMayBeStale: upstreamResult.available,
    commits,
    stashes: stashRecords.slice(0, MAX_STASHES - 1),
    stashesTruncated: stashRecords.length >= MAX_STASHES,
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  getGitStatus,
  parsePorcelainStatus,
  classifyFileStatus
};
