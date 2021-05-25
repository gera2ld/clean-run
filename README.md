# clean-run

Run a Node.js script in a clean environment.

## Motivation

When running a CI script, it is likely that we don't need all dependencies defined in a `package.json`. It might take relatively long time and high bandwidth to install all of them, especially when there are Electron or other family members. In areas with low bandwidth or poor network connections this may be a bigger problem as installation may fail and we have to care about packages that we don't even need.

If you are familiar with Deno, you will miss the feature to run a script with all the dependencies from remote. With this script you can easily run a script like that in Node.js.

## How does this work?

`clean-run` scans the entry script file to see what packages it really depends on and only install those needed. We don't have to set mirrors and wait for large packages that are not even required.

## Usage


```
Usage:

$ clean-run [options] <entryFile> [other arguments ...]

  <entryFile> - path to the main script, set to - if piped from stdin

Options:

  -s - suppress npm logs
  -c - clean after running, requires Node.js >= 14.14.0
  -C <cwd> - set a different path as current working directory, it will be removed if -c is enabled
```

You will need to install this one dependency first.

```bash
$ npm install clean-run
$ clean-run my-script.js
```

Or you can use npx to get a one-liner:

```bash
$ npx clean-run my-script.js
```

You can even run a remote script directly:

```bash
$ curl -fsSL https://raw.githubusercontent.com/gera2ld/clean-run/master/demos/cowsay.js | npx clean-run -
```
