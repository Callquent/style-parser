'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const TokenResolver  = require('./token-resolver');
const { mapProperties, mapProperty, RESERVED_KEYS } = require('./property-mapper');
const Importer       = require('./importer');
const { registry }   = require('./plugin-registry');

/**
 * StyleParser
 *
 * Trois syntaxes supportées pour le type de sélecteur :
 *
 *   1. Clé dupliquée avec type: (syntaxe naturelle CSS)
 *        titi:
 *          type: id
 *        titi:
 *          type: class
 *      → L'importer renomme en titi__id / titi__class avant le parsing YAML.
 *
 *   2. Préfixe dans la clé (alternative explicite)
 *        "#titi": { padding: 15px }
 *        ".titi": { padding: 15px }
 *
 *   3. type: seul (pas de doublon)
 *        header:
 *          type: id
 */
class StyleParser {
  constructor() {
    this.tokens = {};
    this.rawComponents = {};
    this.resolver = null;
  }

  parseFile(filePath) {
    const absolute = path.resolve(filePath);
    if (!fs.existsSync(absolute)) throw new Error(`File not found: ${absolute}`);
    const importer = new Importer();
    const { tokens, components, source } = importer.load(absolute);
    return this._build(tokens, components, source);
  }

  parseString(yamlString, source = '<string>') {
    const processed = registry.applyBeforeParse(yamlString);
    const importer  = new Importer();
    const { tokens, components } = importer.loadString(processed);
    return this._build(tokens, components, source);
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _build(tokens, components, source) {
    this.tokens        = tokens;
    this.resolver      = new TokenResolver(tokens);
    this.rawComponents = components;
    const resolved = this._resolveAll();
    const parsed   = { source, tokens, components: resolved };
    return registry.applyAfterParse(parsed);
  }

  _resolveAll() {
    const components = {};
    for (const [rawKey, def] of Object.entries(this.rawComponents)) {
      const { name, selectorType } = this._parseName(rawKey, def);
      components[rawKey] = this._resolveComponent(name, selectorType, def);
    }
    return components;
  }

  /**
   * Dérive le nom et le type de sélecteur depuis la clé YAML brute.
   *
   * Priorité :
   *   suffixe __id/__class (posé par l'importer) >
   *   préfixe #/. dans la clé                    >
   *   champ type: dans la définition              >
   *   class (défaut)
   */
  _parseName(rawKey, def = {}) {
    // 1. Préfixe explicite dans la clé
    if (rawKey.startsWith('#')) return { name: rawKey.slice(1), selectorType: 'id'    };
    if (rawKey.startsWith('.')) return { name: rawKey.slice(1), selectorType: 'class' };

    // 2. Champ type: dans la définition
    if (def.type === 'id')    return { name: rawKey, selectorType: 'id'    };
    if (def.type === 'class') return { name: rawKey, selectorType: 'class' };

    // 3. Défaut
    return { name: rawKey, selectorType: 'class' };
  }

  _resolveComponent(name, selectorType, def) {
    let merged = { ...def };
    if (def.extends) {
      const parent = this.rawComponents[def.extends]
                  ?? this.rawComponents[`.${def.extends}`]
                  ?? this.rawComponents[`#${def.extends}`];
      if (!parent) throw new Error(`Component "${name}" extends unknown "${def.extends}"`);
      merged = this._deepMerge(parent, def);
    }

    const css      = this._extractCSS(merged);
    const states   = this._extractStates(merged);
    const media    = this._extractMedia(merged);
    const children = this._extractChildren(merged);

    return { name, selectorType, css, states, media, children };
  }

  // ─── CSS / States / Media / Children ──────────────────────────────────────

  _extractCSS(def) {
    const plain = {};
    for (const [key, value] of Object.entries(def)) {
      if (RESERVED_KEYS.has(key)) continue;
      if (key === 'extends') continue;
      if (this._isChildBlock(value)) continue;
      plain[key] = this.resolver.resolve(value);
    }
    return this._mapWithPlugins(plain);
  }

  _extractStates(def) {
    if (!def.states) return {};
    const result = {};
    for (const [state, stateProps] of Object.entries(def.states)) {
      result[state] = this._mapWithPlugins(this.resolver.resolveProps(stateProps));
    }
    return result;
  }

  _extractMedia(def) {
    if (!def.media || typeof def.media !== 'object') return {};
    const result = {};
    for (const [query, block] of Object.entries(def.media)) {
      if (!block || typeof block !== 'object') continue;
      const { states: statesBlock, ...propsBlock } = block;
      const css    = this._mapWithPlugins(this.resolver.resolveProps(propsBlock));
      const states = {};
      if (statesBlock) {
        for (const [state, stateProps] of Object.entries(statesBlock)) {
          states[state] = this._mapWithPlugins(this.resolver.resolveProps(stateProps));
        }
      }
      result[query] = { css, states };
    }
    return result;
  }

  _extractChildren(def) {
    const children = {};
    for (const [key, value] of Object.entries(def)) {
      if (!this._isChildBlock(value)) continue;
      const { media: childMedia, ...rest } = value;
      const css   = this._mapWithPlugins(this.resolver.resolveProps(rest));
      const media = {};
      if (childMedia) {
        for (const [query, block] of Object.entries(childMedia)) {
          if (!block || typeof block !== 'object') continue;
          media[query] = { css: this._mapWithPlugins(this.resolver.resolveProps(block)) };
        }
      }
      children[key] = { css, media };
    }
    return children;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _mapWithPlugins(plain) {
    const css           = {};
    const customMappers = registry.getMappers();
    for (const [key, value] of Object.entries(plain)) {
      if (customMappers.has(key)) {
        Object.assign(css, customMappers.get(key)(value));
      } else {
        Object.assign(css, mapProperty(key, value));
      }
    }
    return css;
  }

  _isChildBlock(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const childKeys = new Set(['size', 'weight', 'color', 'margin-top', 'margin-bottom', 'font-family']);
    return Object.keys(value).some(k => childKeys.has(k));
  }

  _deepMerge(base, override) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (key === 'extends') continue;
      if (
        typeof value === 'object' && !Array.isArray(value) &&
        typeof result[key] === 'object' && !Array.isArray(result[key])
      ) {
        result[key] = this._deepMerge(result[key], value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

module.exports = StyleParser;
