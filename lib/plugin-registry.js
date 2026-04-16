'use strict';

/**
 * PluginRegistry
 *
 * Permet d'étendre style-parser sans modifier le code source.
 * Un plugin peut :
 *   1. Ajouter de nouveaux mappers d'intention (nouvelles clés .ycss)
 *   2. Ajouter de nouveaux générateurs de sortie (nouveaux formats)
 *   3. Enregistrer des hooks before/after parse
 *
 * Usage :
 *   const { plugins } = require('style-parser');
 *
 *   plugins.registerMapper('border', (value) => ({
 *     border: `${value} solid currentColor`
 *   }));
 *
 *   plugins.registerGenerator('html', MyHTMLGenerator);
 *
 *   plugins.use(myPlugin); // plugin = { name, mappers, generators, hooks }
 */
class PluginRegistry {
  constructor() {
    this._mappers    = new Map();
    this._generators = new Map();
    this._hooks      = { beforeParse: [], afterParse: [] };
  }

  // ─── Mappers ────────────────────────────────────────────────────────────────

  /**
   * Enregistre un nouveau mapper d'intention.
   *
   * @param {string} key        Clé dans le fichier .ycss (ex: "border")
   * @param {Function} fn       (value: string) => { [cssProp]: cssValue }
   * @param {object} [opts]
   * @param {boolean} [opts.override=false]  Écrase un mapper existant
   */
  registerMapper(key, fn, { override = false } = {}) {
    if (this._mappers.has(key) && !override) {
      throw new Error(
        `Un mapper "${key}" existe déjà. Utilisez { override: true } pour le remplacer.`
      );
    }
    if (typeof fn !== 'function') {
      throw new TypeError(`Le mapper "${key}" doit être une fonction.`);
    }
    this._mappers.set(key, fn);
    return this;
  }

  /**
   * Retourne tous les mappers custom (fusion avec les built-ins dans le property-mapper).
   * @returns {Map<string, Function>}
   */
  getMappers() {
    return this._mappers;
  }

  // ─── Générateurs ────────────────────────────────────────────────────────────

  /**
   * Enregistre un nouveau générateur de sortie.
   *
   * @param {string} format       Nom du format (ex: "html", "tailwind")
   * @param {Function} Generator  Classe avec une méthode generate(parsed): string
   */
  registerGenerator(format, Generator) {
    if (typeof Generator !== 'function' || typeof Generator.prototype.generate !== 'function') {
      throw new TypeError(`Le générateur "${format}" doit être une classe avec une méthode generate().`);
    }
    this._generators.set(format, Generator);
    return this;
  }

  /**
   * @returns {Map<string, Function>}
   */
  getGenerators() {
    return this._generators;
  }

  // ─── Hooks ──────────────────────────────────────────────────────────────────

  /**
   * Enregistre un hook appelé avant le parsing YAML.
   * @param {Function} fn  (yamlString: string) => string
   */
  onBeforeParse(fn) {
    this._hooks.beforeParse.push(fn);
    return this;
  }

  /**
   * Enregistre un hook appelé après le parsing, sur l'arbre normalisé.
   * @param {Function} fn  (parsed: ParsedStylesheet) => ParsedStylesheet
   */
  onAfterParse(fn) {
    this._hooks.afterParse.push(fn);
    return this;
  }

  applyBeforeParse(yaml) {
    return this._hooks.beforeParse.reduce((s, fn) => fn(s), yaml);
  }

  applyAfterParse(parsed) {
    return this._hooks.afterParse.reduce((p, fn) => fn(p), parsed);
  }

  // ─── Plugin bundle ──────────────────────────────────────────────────────────

  /**
   * Charge un plugin complet.
   *
   * Un plugin est un objet :
   * {
   *   name: 'mon-plugin',
   *   mappers:    { border: fn, ... },
   *   generators: { html: MyGen, ... },
   *   hooks: {
   *     beforeParse: fn,
   *     afterParse:  fn,
   *   }
   * }
   *
   * @param {object} plugin
   */
  use(plugin) {
    if (!plugin || !plugin.name) {
      throw new Error('Un plugin doit avoir une propriété "name".');
    }

    for (const [key, fn] of Object.entries(plugin.mappers ?? {})) {
      this.registerMapper(key, fn, { override: true });
    }
    for (const [fmt, Gen] of Object.entries(plugin.generators ?? {})) {
      this.registerGenerator(fmt, Gen);
    }
    if (plugin.hooks?.beforeParse) this.onBeforeParse(plugin.hooks.beforeParse);
    if (plugin.hooks?.afterParse)  this.onAfterParse(plugin.hooks.afterParse);

    return this;
  }

  // ─── Reset (utile pour les tests) ───────────────────────────────────────────
  reset() {
    this._mappers.clear();
    this._generators.clear();
    this._hooks = { beforeParse: [], afterParse: [] };
    return this;
  }
}

// Singleton partagé dans tout le module
const registry = new PluginRegistry();

module.exports = { PluginRegistry, registry };
