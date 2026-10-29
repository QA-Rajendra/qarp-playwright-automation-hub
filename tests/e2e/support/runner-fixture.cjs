'use strict';

const path = require('node:path');
const { createRunnerServer } = require('../../../runner-server.js');
const { test: base } = require('@playwright/test');

const projectRoot = path.resolve(__dirname, '../../..');

const test = base.extend({
  runner: [async ({}, use) => {
    const server = createRunnerServer({
      port: 0,
      host: '127.0.0.1',
      projectRoot,
      openBrowserOnStart: false
    });

    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    try {
      await use({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        projectRoot
      });
    } finally {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  }, { scope: 'worker' }]
});

module.exports = { expect: base.expect, test };
