#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const child_process = require('child_process');

const ROOT_PATH = path.dirname(__dirname);
const CHECKSUM_PATH = path.join(ROOT_PATH, 'build', '.checksum');

maybeRebuildAndRun().catch(error => {
  console.error(require('chalk').red(error.stack));
});

async function maybeRebuildAndRun() {
  const { projectHash, isRebuildingRequired } = await checkForUpdates();

  if (isRebuildingRequired) {
    await spawnAsync('yarn', []);

    const ora = require('ora');
    const chalk = require('chalk');

    const spinner = ora().start(
      `${chalk.cyan(chalk.bold('expotools'))} ${chalk.italic(`are not up to date - rebuilding...\n`)}`
    );

    await spawnAsync('yarn', ['run', 'clean']);

    try {
      await spawnAsync('yarn', ['run', 'build']);
    } catch (error) {
      // TypeScript compiler might fail because of errors but the code might have been generated anyway (status = 2).
      // Unfortunately, when running this script as a build phase in Xcode, build command rejects with a status = 1,
      // even though tsc exited with code = 2, so we use this stupid RegExp test here.
      if (!/exit code 2/.test(error.stderr)) {
        console.error(chalk.red(`Building failed: ${error.stack}`));
        console.error(error);
        process.exit(1);
        return;
      }
    }
    spinner.succeed();
  }

  // Write checksum to the file.
  fs.writeFileSync(CHECKSUM_PATH, projectHash || await calculateProjectHash());

  run();
}

async function checkForUpdates() {
  const projectHash = await calculateProjectHash();
  const currentHash = readCurrentHash();

  return {
    projectHash,
    isRebuildingRequired: !projectHash || projectHash !== currentHash,
  };
}

function readCurrentHash() {
  if (!fs.existsSync(CHECKSUM_PATH)) {
    return '';
  }
  return fs.readFileSync(CHECKSUM_PATH, 'utf8');
}

async function calculateProjectHash() {
  if (canRequire('folder-hash')) {
    const { hashElement } = require('folder-hash');
    const { hash } = await hashElement(ROOT_PATH, {
      folders: {
        exclude: ['build', 'node_modules'],
      },
      files: {
        include: ['*.ts', 'expotools.js', 'yarn.lock', 'tsconfig.js'],
      },
    });
    return hash;
  }
  return null;
}

function spawnAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = child_process.spawn(command, args, options || {
      stdio: ['pipe', 'ignore', 'pipe'],
      cwd: ROOT_PATH,
    });

    child.on('exit', code => {
      child.removeAllListeners();
      resolve(code);
    });
    child.on('error', error => {
      child.removeAllListeners();
      reject(error);
    });
  });
}

function canRequire(packageName) {
  try {
    require.resolve(packageName);
    return true;
  } catch (error) {
    return false;
  }
}

function run() {
  const chalk = require('chalk');
  const semver = require('semver');
  const nodeVersion = process.versions.node.split('-')[0]; // explode and truncate tag from version
  
  // Validate that used Node version is supported
  if (semver.satisfies(nodeVersion, '>=8.9.0')) {
    require('../build/expotools-cli.js').run();
  } else {
    console.log(
      chalk.red(
        `Node version ${chalk.cyan(nodeVersion)} is not supported. Please use Node.js ${chalk.cyan('8.9.0')} or higher.`
      ),
    );
    process.exit(1);
  }
}
