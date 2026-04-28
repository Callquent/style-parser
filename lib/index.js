'use strict';

/**
 * style-parser — API publique
 *
 * Fichiers internes :
 *   core.js      — TokenResolver, PropertyMapper, GroupLoader
 *   pipeline.js  — PluginRegistry, Importer, Linter, StyleParser
 *   css-converter.js — CSSConverter (CSS → .ycss)
 *
 * Usage de base :
 *   const { compile, compileString } = require('style-parser');
 *   const css = compile('./button.ycss', 'css');
 *
 * Usage avec plugins :
 *   const { plugins } = require('style-parser');
 *   plugins.registerMapper('border', v => ({ border: `${v} solid currentColor` }));
 *
 * Usage avec linter :
 *   const { Linter } = require('style-parser');
 *   const { ok, diagnostics } = new Linter().lint(yamlString);
 *
 * Usage avec imports :
 *   # @import "./tokens.ycss"    ← directive dans un fichier .ycss
 *
 * Usage avec conversion CSS → .ycss :
 *   const { CSSConverter } = require('style-parser');
 *   const yaml = new CSSConverter().convertFile('./input.css');
 */

const { TokenResolver, mapProperty, mapProperties, RESERVED_KEYS, GroupLoader, loader: groupLoader } = require('./core');
const { PluginRegistry, registry, Importer, Linter, StyleParser } = require('./pipeline');
const CSSConverter = require('./css-converter');

const CSSGenerator     = require('./generators/css');
const SassGenerator    = require('./generators/sass');
const CSSinJSGenerator = require('./generators/css-in-js');

// ─── Résolution des générateurs ──────────────────────────────────────────────

function _getGenerators() {
  return {
    css:  CSSGenerator,
    sass: SassGenerator,
    js:   CSSinJSGenerator,
    ...Object.fromEntries(registry.getGenerators()),
  };
}

function _resolveGenerator(format) {
  const gens = _getGenerators();
  const Gen  = gens[format];
  if (!Gen) throw new Error(`Format inconnu: "${format}". Disponibles: ${Object.keys(gens).join(', ')}`);
  return Gen;
}

// ─── API publique ────────────────────────────────────────────────────────────

/** Compile un fichier .ycss vers le format demandé. */
function compile(filePath, format = 'css') {
  return new (_resolveGenerator(format))().generate(new StyleParser().parseFile(filePath));
}

/** Compile une chaîne YAML vers le format demandé. */
function compileString(yamlString, format = 'css') {
  return new (_resolveGenerator(format))().generate(new StyleParser().parseString(yamlString));
}

/** Convertit un fichier CSS en .ycss YAML. */
function convertCSS(filePath) {
  return new CSSConverter().convertFile(filePath);
}

/** Convertit une chaîne CSS en .ycss YAML. */
function convertCSSString(cssString) {
  return new CSSConverter().convertString(cssString);
}

module.exports = {
  // Raccourcis
  compile,
  compileString,
  convertCSS,
  convertCSSString,

  // Classes
  StyleParser,
  CSSGenerator,
  SassGenerator,
  CSSinJSGenerator,
  Linter,
  Importer,
  CSSConverter,

  // Core
  TokenResolver,
  GroupLoader,

  // Plugin system
  plugins: registry,
  PluginRegistry,
};
