#!/usr/bin/env node
/**
 * Run script from a clean environment, where no third-party dependency is available.
 */
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { builtinModules } = require('module');
const { spawn } = require('child_process');

const USAGE = `\
Usage:

$ clean-run [options] <entryFile> [other arguments ...]

  <entryFile>       path to the main script, set to - if piped from stdin

Options:

  -s                suppress npm logs

`;

async function scanDeps(entry, deps, visited) {
  if (visited.has(entry)) {
    console.warn('Possible circular dependency:', entry);
    return;
  }
  visited.add(entry);
  const code = typeof entry === 'string' ? await fs.readFile(entry, 'utf8') : entry.content;
  const re = /\brequire\((['"])([^'"]*)\1/g;
  let match;
  while (match = re.exec(code)) {
    let dep = match[2];
    if (dep.startsWith('.')) {
      // relative path
      const subentry = require.resolve(path.resolve(path.dirname(typeof entry === 'string' ? entry : entry.path), dep));
      await scanDeps(subentry, deps, visited);
      continue;
    }
    if (dep.startsWith('@')) {
      // scoped package
      dep = dep.split('/').slice(0, 2).join('/');
    } else {
      // normal package
      dep = dep.split('/')[0];
    }
    if (!builtinModules.includes(dep)) deps.add(dep);
  }
}

async function spawnAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    const { stdin, silent, ...rest } = options;
    const child = spawn(command, args, {
      stdio: 'pipe',
      ...rest,
    });
    if (!silent) {
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
    }
    child.on('error', err => {
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (code) reject({ code, signal });
      else resolve();
    });
    if (stdin) child.stdin.end(stdin, 'utf8');
  });
}

async function installDeps(deps, options) {
  const spawnOptions = { silent: options.silent };
  if (options.cwd) {
    spawnOptions.cwd = options.cwd;
  }
  return spawnAsync('npm', ['install', '--no-save', '--no-package-lock', ...deps], spawnOptions);
}

function parseArgs(args) {
  const options = {
    cwd: path.join(os.tmpdir(), 'clean-run-' + Math.random().toString(36).slice(2)),
  };
  let rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!/^-\w/.test(arg)) {
      rest = args.slice(i);
      break;
    }
    for (let j = 1; j < arg.length; j += 1) {
      const c = arg[j];
      if (c === 's') {
        options.silent = true;
      } else if (c === 'h') {
        options.help = true;
      }
    }
  }
  return { options, rest };
}

async function readStream(input) {
  input.setEncoding('utf8');
  return new Promise(resolve => {
    const chunks = [];
    input.on('data', chunk => {
      chunks.push(chunk);
    });
    input.on('end', () => {
      resolve(chunks.join(''));
    });
  });
}

async function main() {
  const deps = new Set();
  const visited = new Set();
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.error(USAGE);
    return;
  }
  const [entryFile] = rest;
  if (!entryFile) {
    console.error(USAGE);
    throw new Error('entryFile is required');
  }
  let entry;
  if (entryFile === '-') {
    entry = {
      path: entryFile,
      content: await readStream(process.stdin),
    };
  } else {
    entry = require.resolve(path.resolve(entryFile));
  }
  await fs.mkdir(options.cwd, { recursive: true });
  await scanDeps(entry, deps, visited);
  const pkgFile = path.resolve(options.cwd, 'package.json');
  await fs.writeFile(pkgFile, '{}', 'utf8');
  const modulesPath = path.resolve(options.cwd, 'node_modules');
  await installDeps(deps, options);
  await spawnAsync('node', rest, {
    env: {
      ...process.env,
      NODE_PATH: modulesPath,
    },
    stdin: typeof entry === 'string' ? null : entry.content,
  });
  const rmOptions = { force: true, recursive: true };
  await fs.rm(pkgFile, rmOptions);
  await fs.rm(modulesPath, rmOptions);
  await fs.rm(options.cwd, rmOptions);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

