'use strict';

const { execFileSync } = require('child_process');
const http = require('http');
const https = require('https');
const { getServerUrl } = require('./config');

const AUTO_UPDATE_ENV = 'VOID_TERM_AUTO_UPDATE';
const SKIP_UPDATE_ENV = 'VOID_TERM_SKIP_AUTO_UPDATE';

function parseSemver(value) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value || '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isRemoteNewer(localVersion, remoteVersion) {
  const local = parseSemver(localVersion);
  const remote = parseSemver(remoteVersion);
  if (!local || !remote) return remoteVersion !== localVersion;
  for (let i = 0; i < 3; i += 1) {
    if (remote[i] > local[i]) return true;
    if (remote[i] < local[i]) return false;
  }
  return false;
}

function fetchJson(url, timeoutMs = 4000) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('invalid JSON response'));
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
  });
}

function runGlobalInstall(tarballUrl) {
  execFileSync('npm', ['install', '-g', tarballUrl], { stdio: 'inherit' });
}

function relaunchSelf() {
  const env = { ...process.env, [SKIP_UPDATE_ENV]: '1' };
  execFileSync('void-term', process.argv.slice(2), { stdio: 'inherit', env });
}

async function autoUpdateIfNeeded(localVersion) {
  const autoUpdate = process.env[AUTO_UPDATE_ENV];
  if (autoUpdate === '0' || autoUpdate === 'false') return false;
  if (process.env[SKIP_UPDATE_ENV] === '1') return false;

  const baseUrl = getServerUrl().replace(/\/+$/, '');
  const versionUrl = `${baseUrl}/client/version`;

  let remoteVersion;
  try {
    const info = await fetchJson(versionUrl);
    remoteVersion = info?.version;
  } catch (err) {
    console.error(`[updater] Skipping update check (${err.message})`);
    return false;
  }

  if (!remoteVersion || !isRemoteNewer(localVersion, remoteVersion)) return false;

  const tarballUrl = `${baseUrl}/client/void-term.tgz`;
  console.log(`[updater] Updating void-term ${localVersion} -> ${remoteVersion}`);

  try {
    runGlobalInstall(tarballUrl);
    console.log('[updater] Update installed. Relaunching...');
    relaunchSelf();
    process.exit(0);
  } catch (err) {
    console.error(`[updater] Auto-update failed: ${err.message}`);
  }

  return false;
}

module.exports = { autoUpdateIfNeeded };
