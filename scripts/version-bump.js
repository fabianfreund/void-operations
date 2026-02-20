#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_FILES = ['package.json', 'server/package.json', 'client/package.json'];
const VALID_BUMPS = new Set(['patch', 'minor', 'major']);

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
  if (!match) throw new Error(`Invalid semver version: ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bumpVersion(version, kind) {
  const parsed = parseVersion(version);
  if (kind === 'major') return `${parsed.major + 1}.0.0`;
  if (kind === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function chooseBumpKind() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    stdout.write('\nSelect version bump:\n');
    stdout.write('  1) patch (bugfix)\n');
    stdout.write('  2) minor (feature)\n');
    stdout.write('  3) major (breaking)\n\n');
    const answer = (await rl.question('Choose [1-3] (default 1): ')).trim() || '1';
    if (answer === '1' || answer.toLowerCase() === 'patch' || answer.toLowerCase() === 'bug') return 'patch';
    if (answer === '2' || answer.toLowerCase() === 'minor') return 'minor';
    if (answer === '3' || answer.toLowerCase() === 'major') return 'major';
    throw new Error(`Unknown selection: ${answer}`);
  } finally {
    rl.close();
  }
}

function getBumpArg() {
  const arg = process.argv[2]?.toLowerCase();
  if (!arg) return null;
  if (arg === 'bu' || arg === 'bug' || arg === 'patch') return 'patch';
  if (arg === 'minor') return 'minor';
  if (arg === 'major') return 'major';
  return arg;
}

async function main() {
  const requested = getBumpArg();
  const bumpKind = requested || (await chooseBumpKind());
  if (!VALID_BUMPS.has(bumpKind)) {
    throw new Error(`Invalid bump "${bumpKind}". Use patch/minor/major.`);
  }

  const rootPkgPath = path.join(ROOT, 'package.json');
  const rootPkg = readJson(rootPkgPath);
  const currentVersion = rootPkg.version;
  const nextVersion = bumpVersion(currentVersion, bumpKind);

  for (const relPath of PACKAGE_FILES) {
    const absPath = path.join(ROOT, relPath);
    const pkg = readJson(absPath);
    pkg.version = nextVersion;
    writeJson(absPath, pkg);
  }

  stdout.write(`\nBumped ${bumpKind}: ${currentVersion} -> ${nextVersion}\n`);
  stdout.write('Updated files:\n');
  for (const relPath of PACKAGE_FILES) stdout.write(`  - ${relPath}\n`);
  stdout.write('\n');
}

main().catch((err) => {
  console.error(`\nVersion bump failed: ${err.message}`);
  process.exit(1);
});
