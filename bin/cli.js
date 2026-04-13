#!/usr/bin/env node
'use strict';

const fs      = require('fs');
const path    = require('path');
const { compile, Linter } = require('../lib/index');

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', cyan: '\x1b[36m', red: '\x1b[31m',
  yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m',
};
const f = (color, text) => `${c[color]}${text}${c.reset}`;

// ─── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  printHelp(); process.exit(0);
}

const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i !== -1 ? (args[i + 1] !== undefined && !args[i+1].startsWith('--') ? args[i + 1] : true) : fallback;
};

const inputFile = args.find(a => !a.startsWith('-'));
const format    = flag('--format', 'css');
const outDir    = flag('--out');
const watch     = args.includes('--watch') || args.includes('-w');
const lint      = args.includes('--lint');
const silent    = args.includes('--silent');

const EXT = { css: '.css', sass: '.scss', js: '.js' };

if (!inputFile)  die('Aucun fichier spécifié.');
if (!EXT[format] && !lint) die(`Format inconnu "${format}". Valeurs: css, sass, js`);

// ─── Lint mode ───────────────────────────────────────────────────────────────
if (lint) {
  const raw = fs.readFileSync(path.resolve(inputFile), 'utf8');
  const { ok, diagnostics } = new Linter().lint(raw);
  printLintResult(inputFile, ok, diagnostics);
  process.exit(ok ? 0 : 1);
}

// ─── Compile ─────────────────────────────────────────────────────────────────
function run(filePath) {
  const start = Date.now();
  try {
    const output = compile(filePath, format);
    const ms     = Date.now() - start;
    const lines  = output.split('\n').length;

    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      const name    = path.basename(filePath, path.extname(filePath));
      const outFile = path.join(outDir, name + EXT[format]);
      fs.writeFileSync(outFile, output, 'utf8');
      if (!silent) log(`${f('green','✔')} ${f('cyan', outFile)} ${f('dim', `${lines} lignes · ${ms}ms`)}`);
    } else {
      process.stdout.write(output);
    }
    return true;
  } catch (err) {
    err_log(`${err.message}`);
    return false;
  }
}

// ─── Watch mode ──────────────────────────────────────────────────────────────
if (watch) {
  let chokidar;
  try { chokidar = require('chokidar'); }
  catch { die('chokidar non disponible. Installez-le: npm install chokidar'); }

  if (!silent) {
    console.error(`\n  ${f('bold','style-parser')} ${f('dim','· watch')}\n`);
    log(`${f('yellow','⟳')} Surveillance de ${f('cyan', inputFile)}\n`);
  }

  run(inputFile);

  // Résoudre les imports pour surveiller tous les fichiers dépendants
  const watched = new Set([path.resolve(inputFile)]);

  const watcher = chokidar.watch([...watched], {
    persistent: true, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80 },
  });

  watcher.on('change', (changedPath) => {
    if (!silent) log(`${f('yellow','⟳')} ${path.relative(process.cwd(), changedPath)} modifié`);
    run(inputFile);
  });

  watcher.on('error', (err) => err_log(err.message));

  process.on('SIGINT', () => {
    watcher.close();
    if (!silent) console.error(`\n  ${f('dim','Arrêt du watcher.')}\n`);
    process.exit(0);
  });

} else {
  if (!silent) console.error(`\n  ${f('bold','style-parser')} ${f('dim','· ' + inputFile + ' → ' + format.toUpperCase())}\n`);
  const ok = run(inputFile);
  process.exit(ok ? 0 : 1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function printLintResult(file, ok, diagnostics) {
  const counts = { error: 0, warning: 0, info: 0 };
  diagnostics.forEach(d => counts[d.severity]++);

  console.error(`\n  ${f('bold','style-parser lint')} · ${file}\n`);

  if (diagnostics.length === 0) {
    console.error(`  ${f('green','✔')} Aucun problème détecté.\n`);
    return;
  }

  const SEV = {
    error:   f('red',     '✖ error  '),
    warning: f('yellow',  '⚠ warning'),
    info:    f('blue',    'ℹ info   '),
  };

  diagnostics.forEach(d => {
    console.error(`  ${SEV[d.severity]}  ${f('dim', d.path)}`);
    console.error(`             ${d.message}`);
    console.error(`             ${f('dim', d.code)}\n`);
  });

  console.error(`  ${f('dim','─'.repeat(44))}`);
  console.error(`  ${counts.error   ? f('red',    `${counts.error} erreur(s)`)    : ''} ` +
                `${counts.warning ? f('yellow', `${counts.warning} avertissement(s)`) : ''} ` +
                `${counts.info    ? f('blue',   `${counts.info} info`)             : ''}\n`);
}

function printHelp() {
  console.log(`
  ${f('bold','style-parser')} ${f('dim','v1.0.0')}

  Transpile un fichier ${f('cyan','.style')} (YAML) en CSS, SCSS ou CSS-in-JS.

  ${f('bold','Usage:')}
    style-parser <fichier.style> [options]

  ${f('bold','Options:')}
    ${f('cyan','--format')}   css | sass | js     Format de sortie ${f('dim','(défaut: css)')}
    ${f('cyan','--out')}      <dossier>            Dossier de destination ${f('dim','(défaut: stdout)')}
    ${f('cyan','--watch')}  ${f('dim','-w')}                  Surveille les modifications ${f('dim','(chokidar)')}
    ${f('cyan','--lint')}                          Valide le fichier sans compiler
    ${f('cyan','--silent')}                        Pas de logs (stdout uniquement)
    ${f('cyan','--help')}   ${f('dim','-h')}                  Affiche cette aide

  ${f('bold','Exemples:')}
    style-parser button.style
    style-parser button.style --format sass --out dist/
    style-parser button.style --lint
    style-parser button.style --watch --format css --out dist/
    style-parser button.style --silent --format js > styles.js
`);
}

function log(msg)     { console.error(`  ${msg}`); }
function err_log(msg) { console.error(`  ${f('red','✖')} ${msg}`); }
function die(msg)     { err_log(msg); process.exit(1); }
