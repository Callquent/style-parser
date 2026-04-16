#!/usr/bin/env node
'use strict';

/**
 * style-parser CLI
 *
 * Commands:
 *   style-parser build <file.ycss> [format]   Compile a .ycss file (default: css)
 *   style-parser convert <file.css>            Convert a CSS file to .ycss YAML
 *   style-parser lint <file.ycss>             Lint a .ycss file
 */

const fs   = require('fs');
const path = require('path');
const { compile, convertCSS, Linter } = require('../lib/index');

const [,, command, ...args] = process.argv;

const FORMATS   = ['css', 'sass', 'js'];
const EXT       = { css: '.css', sass: '.scss', js: '.js' };

function resolveFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error(`✖ File not found: ${abs}`);
    process.exit(1);
  }
  return abs;
}

switch (command) {
  case 'build': {
    const [fileArg, fmtArg = 'css'] = args;
    if (!fileArg) {
      // fallback: look for test.ycss in cwd
      const fallback = path.join(process.cwd(), 'test.ycss');
      if (fs.existsSync(fallback)) {
        buildFile(fallback, fmtArg);
      } else {
        console.error('Usage: style-parser build <file.ycss> [css|sass|js]');
        process.exit(1);
      }
    } else {
      buildFile(resolveFile(fileArg), fmtArg);
    }
    break;
  }

  case 'convert': {
    const [fileArg] = args;
    if (!fileArg) {
      console.error('Usage: style-parser convert <file.css>');
      process.exit(1);
    }
    const abs    = resolveFile(fileArg);
    const output = abs.replace(/\.css$/, '.ycss');
    try {
      const yaml = convertCSS(abs);
      fs.writeFileSync(output, yaml, 'utf8');
      console.log(`✔ ${path.basename(output)} generated`);
    } catch (err) {
      console.error(`✖ ${err.message}`);
      process.exit(1);
    }
    break;
  }

  case 'lint': {
    const [fileArg] = args;
    if (!fileArg) {
      console.error('Usage: style-parser lint <file.ycss>');
      process.exit(1);
    }
    const abs  = resolveFile(fileArg);
    const yaml = fs.readFileSync(abs, 'utf8');
    const { ok, diagnostics } = new Linter().lint(yaml);
    for (const d of diagnostics) {
      const icon = d.severity === 'error' ? '✖' : d.severity === 'warning' ? '⚠' : 'ℹ';
      console.log(`${icon} [${d.code}] ${d.path}: ${d.message}`);
    }
    if (ok) {
      console.log(`✔ No errors found${diagnostics.length ? ` (${diagnostics.length} warning(s))` : ''}`);
    } else {
      process.exit(1);
    }
    break;
  }

  default: {
    console.log(`style-parser — CSS / SASS / JS compiler for .ycss files

Commands:
  build   <file.ycss> [format]   Compile to css (default), sass, or js
  convert <file.css>              Convert CSS → .ycss YAML
  lint    <file.ycss>            Lint a .ycss file

Examples:
  style-parser build   button.ycss css
  style-parser convert input.css
  style-parser lint    button.ycss
`);
    break;
  }
}

function buildFile(abs, format) {
  if (!FORMATS.includes(format)) {
    console.error(`✖ Unknown format "${format}". Available: ${FORMATS.join(', ')}`);
    process.exit(1);
  }
  const output = abs.replace(/\.ycss$/, EXT[format]);
  try {
    const result = compile(abs, format);
    fs.writeFileSync(output, result, 'utf8');
    const lines = result.split('\n').length;
    console.log(`✔ ${path.basename(output)} generated (${lines} lines)`);
  } catch (err) {
    console.error(`✖ ${err.message}`);
    process.exit(1);
  }
}
