'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// ══════════════════════════════════════════════════════════════════════════════
// TokenResolver
// Remplace les références de tokens (noms de variables) par leurs valeurs
// réelles au moment du parsing.
// ══════════════════════════════════════════════════════════════════════════════

class TokenResolver {
  constructor(variables = {}) {
    this.variables = variables;
  }

  resolve(value) {
    if (typeof value === 'string') return this.variables[value] ?? value;
    if (Array.isArray(value))     return value.map(v => this.resolve(v)).join(' ');
    return value;
  }

  resolveProps(props) {
    const resolved = {};
    for (const [key, val] of Object.entries(props)) {
      resolved[key] = this.resolve(val);
    }
    return resolved;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PropertyMapper
// Mappe les clés DSL (.ycss) vers les propriétés CSS correspondantes.
// ══════════════════════════════════════════════════════════════════════════════

const MAPPERS = {
  layout(value) {
    return { display: 'flex', 'flex-direction': value === 'row' ? 'row' : 'column' };
  },
  center(value) {
    if (value !== true && value !== 'true') return {};
    return { 'align-items': 'center', 'justify-content': 'center' };
  },
  display(value) { return { display: value }; },

  // ─── Box model ─────────────────────────────────────────────────────────────
  margin(value)           { return { margin: value }; },
  'margin-top'(value)     { return { 'margin-top': value }; },
  'margin-right'(value)   { return { 'margin-right': value }; },
  'margin-bottom'(value)  { return { 'margin-bottom': value }; },
  'margin-left'(value)    { return { 'margin-left': value }; },

  padding(value)          { return { padding: value }; },
  'padding-top'(value)    { return { 'padding-top': value }; },
  'padding-right'(value)  { return { 'padding-right': value }; },
  'padding-bottom'(value) { return { 'padding-bottom': value }; },
  'padding-left'(value)   { return { 'padding-left': value }; },

  width(value)            { return { width: value }; },
  height(value)           { return { height: value }; },
  'min-width'(value)      { return { 'min-width': value }; },
  'max-width'(value)      { return { 'max-width': value }; },
  'min-height'(value)     { return { 'min-height': value }; },
  'max-height'(value)     { return { 'max-height': value }; },

  border(value)           { return { border: value }; },
  'border-top'(value)     { return { 'border-top': value }; },
  'border-right'(value)   { return { 'border-right': value }; },
  'border-bottom'(value)  { return { 'border-bottom': value }; },
  'border-left'(value)    { return { 'border-left': value }; },
  'border-color'(value)   { return { 'border-color': value }; },
  'border-width'(value)   { return { 'border-width': value }; },
  'border-style'(value)   { return { 'border-style': value }; },

  radius(value)           { return { 'border-radius': value }; },
  shadow(value)           { return { 'box-shadow': value }; },
  sizing(value)           { return { 'box-sizing': value }; },

  overflow(value)         { return { overflow: value }; },
  'overflow-x'(value)     { return { 'overflow-x': value }; },
  'overflow-y'(value)     { return { 'overflow-y': value }; },

  // ─── Position ──────────────────────────────────────────────────────────────
  position(value)         { return { position: value }; },
  top(value)              { return { top: value }; },
  right(value)            { return { right: value }; },
  bottom(value)           { return { bottom: value }; },
  left(value)             { return { left: value }; },
  'z-index'(value)        { return { 'z-index': value }; },

  // ─── Layout ────────────────────────────────────────────────────────────────
  gap(value)              { return { gap: value }; },
  'flex-wrap'(value)      { return { 'flex-wrap': value }; },
  'flex-grow'(value)      { return { 'flex-grow': value }; },
  'flex-shrink'(value)    { return { 'flex-shrink': value }; },
  'flex-basis'(value)     { return { 'flex-basis': value }; },
  flex(value)             { return { flex: value }; },
  'align-items'(value)    { return { 'align-items': value }; },
  'align-self'(value)     { return { 'align-self': value }; },
  'justify-content'(value){ return { 'justify-content': value }; },

  // ─── Appearance ────────────────────────────────────────────────────────────
  background(value)         { return { background: value }; },
  'background-image'(value) { return { 'background-image': value }; },
  opacity(value)            { return { opacity: value }; },
  cursor(value)             { return { cursor: value }; },
  transition(value)         { return { transition: value }; },
  transform(value)          { return { transform: value }; },

  // ─── Typography ────────────────────────────────────────────────────────────
  size(value)               { return { 'font-size': value }; },
  weight(value) {
    const weights = { bold: '600', semibold: '500', normal: '400', light: '300' };
    return { 'font-weight': weights[value] ?? value };
  },
  color(value)              { return { color: value }; },
  'line-height'(value)      { return { 'line-height': value }; },
  'letter-spacing'(value)   { return { 'letter-spacing': value }; },
  'text-align'(value)       { return { 'text-align': value }; },
  'text-transform'(value)   { return { 'text-transform': value }; },
  'text-decoration'(value)  { return { 'text-decoration': value }; },
  'white-space'(value)      { return { 'white-space': value }; },
  'word-break'(value)       { return { 'word-break': value }; },
  'font-family'(value)      { return { 'font-family': value }; },
  'font-style'(value)       { return { 'font-style': value }; },
};

/** Clés réservées — gérées par le parser, non mappées vers CSS. */
const RESERVED_KEYS = new Set(['extends', 'states', 'type', 'media']);

function mapProperty(key, value) {
  if (RESERVED_KEYS.has(key)) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return {};
  const mapper = MAPPERS[key];
  if (mapper) return mapper(value);
  return { [key]: value };
}

function mapProperties(props) {
  const css = {};
  for (const [key, value] of Object.entries(props)) {
    Object.assign(css, mapProperty(key, value));
  }
  return css;
}

// ══════════════════════════════════════════════════════════════════════════════
// GroupLoader
// Charge groups.yaml et expose les groupes de propriétés (layout, box, typo…).
// Le résultat est mis en cache après le premier chargement.
// ══════════════════════════════════════════════════════════════════════════════

class GroupLoader {
  constructor() {
    this._cache = null;
  }

  /**
   * Charge et parse le fichier de groupes.
   * @param {string} [filePath]  Chemin explicite (optionnel)
   * @returns {{ groupNames, groupSets, propToGroup, defaults }}
   */
  load(filePath) {
    if (this._cache) return this._cache;

    const resolved = this._resolve(filePath);
    if (!resolved) {
      this._cache = this._empty();
      return this._cache;
    }

    const raw  = fs.readFileSync(resolved, 'utf8');
    const doc  = yaml.load(raw) ?? {};
    const defs = doc.groups ?? {};

    const groupNames  = [];
    const groupSets   = new Map();
    const propToGroup = new Map();
    const defaults    = new Map();

    for (const [groupName, groupDef] of Object.entries(defs)) {
      groupNames.push(groupName);
      const set = new Set();

      for (const entry of (groupDef.properties ?? [])) {
        if (typeof entry === 'string') {
          set.add(entry);
          if (!propToGroup.has(entry)) propToGroup.set(entry, groupName);
        } else if (entry && typeof entry === 'object') {
          const [parentKey, childDef] = Object.entries(entry)[0];
          set.add(parentKey);
          if (!propToGroup.has(parentKey)) propToGroup.set(parentKey, groupName);
          for (const child of (childDef?.properties ?? [])) {
            if (typeof child === 'string') {
              set.add(child);
              if (!propToGroup.has(child)) propToGroup.set(child, groupName);
            }
          }
        }
      }

      groupSets.set(groupName, set);
      defaults.set(groupName, groupDef.defaults ?? {});
    }

    this._cache = { groupNames, groupSets, propToGroup, defaults, filePath: resolved };
    return this._cache;
  }

  /** Invalide le cache (utile pour les tests ou le hot-reload). */
  reset() {
    this._cache = null;
    return this;
  }

  _resolve(explicit) {
    if (explicit) {
      const abs = path.resolve(explicit);
      if (fs.existsSync(abs)) return abs;
    }

    // Remonte depuis __dirname jusqu'à trouver groups.yaml hors node_modules
    let dir = __dirname;
    while (true) {
      const candidate = path.join(dir, 'groups.yaml');
      if (fs.existsSync(candidate) && !candidate.includes('node_modules')) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    const fromCwd = path.join(process.cwd(), 'groups.yaml');
    if (fs.existsSync(fromCwd)) return fromCwd;

    const fromDir = path.join(__dirname, 'groups.yaml');
    if (fs.existsSync(fromDir)) return fromDir;

    return null;
  }

  _empty() {
    return {
      groupNames: [], groupSets: new Map(),
      propToGroup: new Map(), defaults: new Map(), filePath: null,
    };
  }
}

// Singleton partagé dans tout le module
const groupLoaderInstance = new GroupLoader();

module.exports = {
  TokenResolver,
  mapProperty,
  mapProperties,
  RESERVED_KEYS,
  GroupLoader,
  loader: groupLoaderInstance,
};
