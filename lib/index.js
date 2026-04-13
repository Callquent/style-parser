'use strict';

/**
 * style-parser — API publique
 *
 * Usage de base :
 *   const { compile, compileString } = require('style-parser');
 *   const css = compile('./button.style', 'css');
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
 *   # @import "./tokens.style"    ← directive dans un fichier .style
 */

const StyleParser      = require('./parser');
const CSSGenerator     = require('./generators/css');
const SassGenerator    = require('./generators/sass');
const CSSinJSGenerator = require('./generators/css-in-js');
const Linter           = require('./linter');
const Importer         = require('./importer');
const { registry, PluginRegistry } = require('./plugin-registry');

// Merge built-in generators + plugin generators at call time
function _getGenerators() {
  return {
    css:  CSSGenerator,
    sass: SassGenerator,
    js:   CSSinJSGenerator,
    ...Object.fromEntries(registry.getGenerators()),
  };
}

function _resolve(format) {
  const gens = _getGenerators();
  const Gen = gens[format];
  if (!Gen) {
    throw new Error(`Format inconnu: "${format}". Disponibles: ${Object.keys(gens).join(', ')}`);
  }
  return Gen;
}

/** Compile un fichier .style vers le format demandé. */
function compile(filePath, format = 'css') {
  const Gen    = _resolve(format);
  const parsed = new StyleParser().parseFile(filePath);
  return new Gen().generate(parsed);
}

/** Compile une chaîne YAML vers le format demandé. */
function compileString(yamlString, format = 'css') {
  const Gen    = _resolve(format);
  const parsed = new StyleParser().parseString(yamlString);
  return new Gen().generate(parsed);
}

module.exports = {
  // Raccourcis
  compile,
  compileString,

  // Classes
  StyleParser,
  CSSGenerator,
  SassGenerator,
  CSSinJSGenerator,
  Linter,
  Importer,

  // Plugin system
  plugins: registry,
  PluginRegistry,
};