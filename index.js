#!/usr/bin/env node
/**
 * Run script from a clean environment, where no third-party dependency is available.
 */
const fs = require('fs').promises;
const path = require('path');
const { builtinModules } = require('module');
const { spawn } = require('child_process');

const USAGE = `\
Usage:

$ clean-run [options] <entryFile> [other arguments ...]

  <entryFile>       path to the main script, set to - if piped from stdin

Options:

  -s                suppress npm logs
  -c                clean after running, requires Node.js >= 14.14.0
  -C <cwd>          set a different path as current working directory, it will be removed if -c is enabled

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
    cwd: '.',
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
      } else if (c === 'c') {
        options.clean = true;
      } else if (c === 'h') {
        options.help = true;
      } else if (c === 'C') {
        if (j < arg.length - 1) {
          throw new Error(`-${c} requires a value`);
        }
        i += 1;
        options.cwd = path.resolve(args[i]);
      }
    }
  }
  return { options, rest };
}

async function exists(fullpath) {
  try {
    await fs.stat(fullpath);
  } catch {
    return false;
  }
  return true;
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
  await scanDeps(entry, deps, visited);
  let cleanCwd = false;
  let cleanPkg = false;
  let cleanModules = false;
  if (options.cwd && !await exists(options.cwd)) {
    await fs.mkdir(options.cwd, { recursive: true });
    cleanCwd = true;
  }
  const pkgFile = path.resolve(options.cwd, 'package.json');
  if (!await exists(pkgFile)) {
    await fs.writeFile(pkgFile, '{}', 'utf8');
    cleanPkg = true;
  }
  const modulesPath = path.resolve(options.cwd, 'node_modules');
  if (!await exists(modulesPath)) {
    cleanModules = true;
  }
  await installDeps(deps, options);
  await spawnAsync('node', rest, {
    env: {
      ...process.env,
      NODE_PATH: modulesPath,
    },
    stdin: typeof entry === 'string' ? null : entry.content,
  });
  if (options.clean) {
    const rmOptions = { force: true, recursive: true };
    if (cleanModules) await fs.rm(modulesPath, rmOptions);
    if (cleanPkg) await fs.rm(pkgFile, rmOptions);
    if (cleanCwd) await fs.rm(options.cwd, rmOptions);
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

