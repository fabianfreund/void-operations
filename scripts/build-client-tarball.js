#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const DIST_DIR = path.join(ROOT, 'server', 'client-dist');
const GENERATED_FILE = path.join(CLIENT_DIR, 'src', 'server-url.generated.js');

const serverUrl = process.env.VOID_SERVER_URL?.trim();

if (serverUrl) {
  const contents = `module.exports = ${JSON.stringify(serverUrl)};\n`;
  fs.writeFileSync(GENERATED_FILE, contents);
} else if (fs.existsSync(GENERATED_FILE)) {
  fs.unlinkSync(GENERATED_FILE);
}

fs.mkdirSync(DIST_DIR, { recursive: true });

const output = execFileSync('npm', ['pack', '--silent'], {
  cwd: CLIENT_DIR,
  encoding: 'utf8',
}).trim();

const tarballName = output.split('\n').pop();
const sourceTarball = path.join(CLIENT_DIR, tarballName);
const destTarball = path.join(DIST_DIR, 'void-term.tgz');

if (fs.existsSync(destTarball)) {
  fs.unlinkSync(destTarball);
}

fs.renameSync(sourceTarball, destTarball);
