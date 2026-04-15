'use strict';

/**
 * build.js — script de compilation du projet
 *
 * Usage direct :   node build.js [format]
 * Via CLI :        style-parser build test.style [format]
 *
 * Formats : css (défaut), sass, js
 */

const { compile } = require('.');
const fs   = require('fs');
const path = require('path');

const format = process.argv[2] ?? 'css';
const EXT    = { css: '.css', sass: '.scss', js: '.js' };

const input  = path.join(__dirname, 'test.style');
const output = path.join(__dirname, `test${EXT[format] ?? '.' + format}`);

try {
  const result = compile(input, format);
  fs.writeFileSync(output, result, 'utf8');
  const lines = result.split('\n').length;
  console.log(`✔ ${path.basename(output)} généré (${lines} lignes)`);
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(1);
}
