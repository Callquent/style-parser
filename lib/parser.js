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
 *
 * Groupes d'attributs supportés (syntaxe optionnelle pour la lisibilité) :
 *   box:          padding, gap, width, height, radius, shadow,
 *                 margin-top, margin-bottom, display
 *   typo:         size, weight, font-family, line-height,
 *                 text-transform, text-align, text-decoration
 *   color:        background, color
 *   interactions: cursor, transition, transform, opacity, overflow
 *
 * Ces groupes sont transparents : ils sont dépliés avant le parsing
 * et n'apparaissent pas dans la sortie CSS.
 */

// Noms de groupes reconnus — dépliés de façon transparente
const PROP_GROUPS = new Set(['box', 'typo', 'color', 'interactions']);

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
    if (rawKey.startsWith('#')) return { name: rawKey.slice(1), selectorType: 'id'    };
    if (rawKey.startsWith('.')) return { name: rawKey.slice(1), selectorType: 'class' };
    if (def.type === 'id')    return { name: rawKey, selectorType: 'id'    };
    if (def.type === 'class') return { name: rawKey, selectorType: 'class' };
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

  // ─── Group flattening ─────────────────────────────────────────────────────

  /**
   * Déplie les groupes (box, typo, color, interactions) dans un objet de props.
   * Les clés de groupe sont remplacées par leur contenu au niveau supérieur.
   *
   * Exemple :
   *   { box: { padding: '16px', radius: '6px' }, color: { background: '#fff' } }
   *   → { padding: '16px', radius: '6px', background: '#fff' }
   */
  _flattenGroups(def) {
    const flat = {};
    for (const [key, value] of Object.entries(def)) {
      if (PROP_GROUPS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(flat, value);
      } else {
        flat[key] = value;
      }
    }
    return flat;
  }

  // ─── CSS / States / Media / Children ──────────────────────────────────────

  _extractCSS(def) {
    // Flatten groups first, then process as before
    const flat  = this._flattenGroups(def);
    const plain = {};
    for (const [key, value] of Object.entries(flat)) {
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
      // Flatten groups inside each state
      const flat = this._flattenGroups(stateProps ?? {});
      result[state] = this._mapWithPlugins(this.resolver.resolveProps(flat));
    }
    return result;
  }

  _extractMedia(def) {
    if (!def.media || typeof def.media !== 'object') return {};
    const result = {};
    for (const [query, block] of Object.entries(def.media)) {
      if (!block || typeof block !== 'object') continue;
      const { states: statesBlock, ...propsBlock } = block;

      // Flatten groups in the media base props
      const flatProps = this._flattenGroups(propsBlock);
      const css       = this._mapWithPlugins(this.resolver.resolveProps(flatProps));

      const states = {};
      if (statesBlock) {
        for (const [state, stateProps] of Object.entries(statesBlock)) {
          // Flatten groups inside media states
          const flatState = this._flattenGroups(stateProps ?? {});
          states[state]   = this._mapWithPlugins(this.resolver.resolveProps(flatState));
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

      // Flatten groups inside the child definition
      const flat = this._flattenGroups(value);
      const { media: childMedia, states: childStates, ...rest } = flat;

      const css = this._mapWithPlugins(this.resolver.resolveProps(rest));

      // Child-level states (e.g. label.states.hover)
      const statesCss = {};
      if (childStates && typeof childStates === 'object') {
        for (const [state, stateProps] of Object.entries(childStates)) {
          const flatState = this._flattenGroups(stateProps ?? {});
          statesCss[state] = this._mapWithPlugins(this.resolver.resolveProps(flatState));
        }
      }

      const media = {};
      if (childMedia) {
        for (const [query, block] of Object.entries(childMedia)) {
          if (!block || typeof block !== 'object') continue;
          const flatBlock = this._flattenGroups(block);
          media[query] = { css: this._mapWithPlugins(this.resolver.resolveProps(flatBlock)) };
        }
      }

      children[key] = { css, states: statesCss, media };
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

  /**
   * Détermine si une valeur représente un bloc enfant (ex: label, title).
   * Un bloc enfant est un objet contenant des clés de style textuel
   * ou des clés de groupe.
   */
  _isChildBlock(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const childKeys = new Set([
      // Propriétés directes (ancienne syntaxe)
      'size', 'weight', 'color', 'margin-top', 'margin-bottom', 'font-family',
      // Noms de groupes (nouvelle syntaxe)
      'box', 'typo', 'interactions',
      // 'color' est déjà là-haut ; on n'y ajoute pas 'color' en double
    ]);
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
