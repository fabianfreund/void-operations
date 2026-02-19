'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.void-ops');
const CONFIG_FILE = path.join(CONFIG_DIR, 'client.json');

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readGeneratedServerUrl() {
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    return require('./server-url.generated');
  } catch {
    return null;
  }
}

function getServerUrl() {
  return (
    process.env.VOID_SERVER ||
    readGeneratedServerUrl() ||
    readJson(CONFIG_FILE)?.serverUrl ||
    'http://localhost:3000'
  );
}

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  getServerUrl,
};
