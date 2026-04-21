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
 * Structure DSL :
 *
 *   components:
 *
 *     # Composant partagé (préfixe @, non généré en CSS directement)
 *     @tutu:
 *       attrs:
 *         box: { padding: sp-1 }
 *         appearance: { background: color-white }
 *
 *     # Composant standard
 *     toto:
 *       attrs:
 *         type: id
 *         layout: { display: inline-block }
 *         box: { width: "100%" }
 *       # Enfant simple
 *       label:
 *         attrs:
 *           typo: { size: 14px }
 *       # Enfant qui hérite d'un composant partagé
 *       tutu:
 *         extends: "@tutu"          # référence au composant partagé
 *         attrs:                    # override local (deep-merge sur attrs du parent)
 *           appearance:
 *             background: color-primary
 *
 * Règles de séparation attrs / enfants :
 *   - `attrs`   → propriétés de style du composant/enfant courant
 *   - `extends` → référence (@xxx) ou nom de composant à hériter
 *   - `states`  → états CSS (:hover, :focus…)
 *   - `media`   → media-queries
 *   - tout autre clé objet → enfant
 *
 * Groupes d'attributs supportés dans attrs: (dépliés de façon transparente) :
 *   layout, box, typo, appearance, style, interactions
 *
 * Syntaxes de sélecteur toujours supportées :
 *   - préfixe @ dans la clé           → composant partagé (non émis en CSS)
 *   - préfixe # / . dans la clé       → id / class explicite
 *   - attrs.type: id | class           → type explicite
 *   - défaut                           → class
 */

const PROP_GROUPS   = new Set(['layout', 'box', 'typo', 'appearance', 'style', 'uiProps', 'position', 'interactions']);
// Clés structurelles d'un bloc composant ou enfant — tout le reste est un enfant
const STRUCTURAL_KEYS = new Set(['attrs', 'extends', 'states', 'media']);

/**
 * Préprocesseur : quote les clés @xxx: pour les rendre valides en YAML.
 * Le @ en début de clé est réservé par la spec YAML et provoque une erreur
 * de parsing si la clé n'est pas entre guillemets.
 *
 * Transforme (en début de ligne, après espaces) :
 *   "  @tutu:"  →  "  \"@tutu\":"
 *
 * Ne touche pas aux valeurs (ex: extends: @tutu reste intact).
 */
function _quoteAtKeys(yamlText) {
  return yamlText.replace(/^(\s*)(?!")(@[\w-]+)(\s*:)/gm, '$1"$2"$3');
}

class StyleParser {
  constructor() {
    this.variables = {};
    this.rawComponents = {};
    this.resolver = null;
  }

  parseFile(filePath) {
    const absolute = path.resolve(filePath);
    if (!fs.existsSync(absolute)) throw new Error(`File not found: ${absolute}`);
    // L'importer gère le préprocessing (@-keys, @-values) et les imports
    const importer = new Importer();
    const { variables, components, source } = importer.load(absolute);
    // Relire le fichier via l'importer préprocessé pour extraire extends:
    const raw     = importer._quoteAtValues(fs.readFileSync(absolute, 'utf8'));
    const rawYaml = yaml.load(raw) ?? {};
    return this._build(variables, components, source, rawYaml.extends ?? {});
  }

  parseString(yamlString, source = '<string>') {
    const processed = registry.applyBeforeParse(yamlString);
    const importer  = new Importer();
    const { variables, components } = importer.loadString(processed);
    const rawYaml   = yaml.load(importer._quoteAtValues(processed)) ?? {};
    return this._build(variables, components, source, rawYaml.extends ?? {});
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _build(variables, components, source, extendsSection = {}) {
    this.variables      = variables;
    this.resolver      = new TokenResolver(variables);
    // Fusionner la section extends: dans rawComponents avec le préfixe @
    // Les entrées de extends: sont des composants partagés (shared), accessibles
    // via extends: @xxx dans les composants ou leurs enfants.
    const merged = { ...components };
    for (const [key, value] of Object.entries(extendsSection)) {
      const k = key.startsWith('@') ? key : `@${key}`;
      if (!(k in merged)) merged[k] = value; // components: a priorité en cas de collision
    }
    this.rawComponents = merged;
    const resolved = this._resolveAll();
    const parsed   = { source, variables, components: resolved };
    return registry.applyAfterParse(parsed);
  }

  _resolveAll() {
    const components = {};
    for (const [rawKey, def] of Object.entries(this.rawComponents)) {
      const { name, selectorType, shared } = this._parseName(rawKey, def);
      // Les composants partagés (@xxx) — qu'ils viennent de components: ou de extends: —
      // ne sont que des templates pour la résolution d'héritage.
      // On ne les inclut PAS dans l'output : le générateur CSS ne doit pas les voir.
      if (shared) continue;
      components[rawKey] = this._resolveComponent(name, selectorType, shared, def);
    }
    return components;
  }

  /**
   * Dérive le nom, le type de sélecteur et le flag "shared" depuis la clé YAML.
   *
   * Priorité :
   *   préfixe @ dans la clé            → shared, type depuis attrs.type ou 'class'
   *   suffixe __id/__class (importer)  → id / class
   *   préfixe # / . dans la clé        → id / class
   *   attrs.type: id | class            → id / class
   *   défaut                            → class
   */
  _parseName(rawKey, def = {}) {
    if (rawKey.startsWith('@')) {
      const attrsType = def.attrs?.type;
      return {
        name: rawKey.slice(1),
        selectorType: attrsType === 'id' ? 'id' : 'class',
        shared: true,
      };
    }
    if (rawKey.startsWith('#')) return { name: rawKey.slice(1), selectorType: 'id',    shared: false };
    if (rawKey.startsWith('.')) return { name: rawKey.slice(1), selectorType: 'class', shared: false };

    const attrsType = def.attrs?.type ?? def.type; // compatibilité ancienne syntaxe
    if (attrsType === 'id')    return { name: rawKey, selectorType: 'id',    shared: false };
    if (attrsType === 'class') return { name: rawKey, selectorType: 'class', shared: false };
    return { name: rawKey, selectorType: 'class', shared: false };
  }

  _resolveComponent(name, selectorType, shared, def) {
    // Résolution de l'héritage top-level (extends: "@tutu" ou extends: titi)
    const merged = this._applyExtends(def);

    const css      = this._extractCSS(merged);
    const states   = this._extractStates(merged);
    const media    = this._extractMedia(merged);
    const children = this._extractChildren(merged);

    return { name, selectorType, shared, css, states, media, children };
  }

  // ─── Extends resolution ───────────────────────────────────────────────────

  /**
   * Résout extends: sur un bloc (composant ou enfant).
   *
   * Valeur attendue :
   *   extends: "@tutu"   → hérite de rawComponents["@tutu"]
   *   extends: titi      → hérite de rawComponents["titi"] (ancienne syntaxe)
   *
   * Le deep-merge se fait sur attrs uniquement :
   *   attrs du parent < attrs du bloc courant.
   * Les enfants, states et media du bloc courant ne sont pas écrasés par le parent.
   */
  _applyExtends(def) {
    if (!def.extends) return def;

    const refKey = def.extends; // ex: "@tutu" ou "titi"
    const parent =
      this.rawComponents[refKey] ??
      this.rawComponents[`@${refKey}`] ??
      this.rawComponents[`.${refKey}`] ??
      this.rawComponents[`#${refKey}`];

    if (!parent) throw new Error(`extends: unknown component "${refKey}"`);

    // Résoudre récursivement l'héritage du parent d'abord
    const resolvedParent = this._applyExtends(parent);

    return {
      ...def,
      attrs: this._deepMerge(resolvedParent.attrs ?? {}, def.attrs ?? {}),
    };
  }

  // ─── Group flattening ─────────────────────────────────────────────────────

  /**
   * Déplie les groupes de propriétés (layout, box, typo, appearance, interactions)
   * présents dans un objet d'attributs.
   *
   *   { box: { padding: '16px' }, appearance: { background: '#fff' } }
   *   → { padding: '16px', background: '#fff' }
   */
  _flattenGroups(attrs) {
    const flat = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (PROP_GROUPS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(flat, value);
      } else {
        flat[key] = value;
      }
    }
    return flat;
  }

  // ─── CSS / States / Media / Children ──────────────────────────────────────

  /**
   * Extrait les propriétés CSS depuis def.attrs.
   * Les clés structurelles (type, extends) sont ignorées.
   */
  _extractCSS(def) {
    const attrs = def.attrs ?? {};
    const flat  = this._flattenGroups(attrs);
    const plain = {};
    for (const [key, value] of Object.entries(flat)) {
      if (RESERVED_KEYS.has(key)) continue;
      if (key === 'type' || key === 'extends') continue;
      plain[key] = this.resolver.resolve(value);
    }
    return this._mapWithPlugins(plain);
  }

  /**
   * Extrait les états CSS depuis def.states.
   * Chaque état contient ses propres attrs (avec groupes).
   */
  _extractStates(def) {
    if (!def.states) return {};
    const result = {};
    for (const [state, stateBlock] of Object.entries(def.states)) {
      // Un état peut être { attrs: {...} } ou directement { padding: ... } (compat)
      const attrs = stateBlock?.attrs ?? stateBlock ?? {};
      const flat  = this._flattenGroups(attrs);
      result[state] = this._mapWithPlugins(this.resolver.resolveProps(flat));
    }
    return result;
  }

  /**
   * Extrait les media-queries depuis def.media.
   * Chaque query contient attrs: et/ou states:.
   */
  _extractMedia(def) {
    if (!def.media || typeof def.media !== 'object') return {};
    const result = {};
    for (const [query, block] of Object.entries(def.media)) {
      if (!block || typeof block !== 'object') continue;

      // Supports { attrs: {...}, states: {...} } et ancienne syntaxe plate
      const attrsBlock  = block.attrs ?? {};
      const statesBlock = block.states;
      const legacyProps = Object.fromEntries(
        Object.entries(block).filter(([k]) => k !== 'attrs' && k !== 'states')
      );
      const mergedAttrs = { ...legacyProps, ...attrsBlock };

      const flatProps = this._flattenGroups(mergedAttrs);
      const css       = this._mapWithPlugins(this.resolver.resolveProps(flatProps));

      const states = {};
      if (statesBlock) {
        for (const [state, stateBlock] of Object.entries(statesBlock)) {
          const attrs     = stateBlock?.attrs ?? stateBlock ?? {};
          const flatState = this._flattenGroups(attrs);
          states[state]   = this._mapWithPlugins(this.resolver.resolveProps(flatState));
        }
      }
      result[query] = { css, states };
    }
    return result;
  }

  /**
   * Extrait les enfants : toute clé qui n'est pas dans STRUCTURAL_KEYS
   * et dont la valeur est un objet (ou une référence @xxx).
   *
   * Syntaxe enfant :
   *   label:                    # enfant simple
   *     attrs: { ... }
   *
   *   tutu:                     # enfant avec héritage
   *     extends: "@tutu"
   *     attrs: { ... }          # override
   */
  _extractChildren(def) {
    const children = {};

    for (const [key, value] of Object.entries(def)) {
      if (STRUCTURAL_KEYS.has(key)) continue;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;

      // Résolution de l'héritage de l'enfant
      const resolved = this._applyExtends(value);

      const flat = this._flattenGroups(resolved.attrs ?? {});
      const { states: childStatesBlock, media: childMediaBlock } = resolved;

      // CSS de l'enfant (depuis ses attrs)
      const plainAttrs = {};
      for (const [k, v] of Object.entries(flat)) {
        if (k === 'type' || k === 'extends') continue;
        if (RESERVED_KEYS.has(k)) continue;
        plainAttrs[k] = this.resolver.resolve(v);
      }
      const css = this._mapWithPlugins(plainAttrs);

      // States de l'enfant
      const statesCss = {};
      if (childStatesBlock && typeof childStatesBlock === 'object') {
        for (const [state, stateBlock] of Object.entries(childStatesBlock)) {
          const attrs     = stateBlock?.attrs ?? stateBlock ?? {};
          const flatState = this._flattenGroups(attrs);
          statesCss[state] = this._mapWithPlugins(this.resolver.resolveProps(flatState));
        }
      }

      // Media de l'enfant
      const media = {};
      if (childMediaBlock && typeof childMediaBlock === 'object') {
        for (const [query, block] of Object.entries(childMediaBlock)) {
          if (!block || typeof block !== 'object') continue;
          const attrsBlock = block.attrs ?? {};
          const legacyProps = Object.fromEntries(
            Object.entries(block).filter(([k]) => k !== 'attrs' && k !== 'states')
          );
          const flatBlock = this._flattenGroups({ ...legacyProps, ...attrsBlock });
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
   * Deep-merge de deux objets attrs.
   * Les objets imbriqués sont fusionnés récursivement ;
   * les scalaires de `override` écrasent ceux de `base`.
   */
  _deepMerge(base, override) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (
        typeof value === 'object' && !Array.isArray(value) && value !== null &&
        typeof result[key] === 'object' && !Array.isArray(result[key]) && result[key] !== null
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
