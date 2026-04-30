'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { TokenResolver, mapProperty, mapProperties, RESERVED_KEYS, loader: groupLoader } = require('./core');

// ══════════════════════════════════════════════════════════════════════════════
// PluginRegistry
// Permet d'étendre style-parser sans modifier le code source :
//   plugins.registerMapper('border', fn)
//   plugins.registerGenerator('html', MyGen)
//   plugins.use(myPlugin)
// ══════════════════════════════════════════════════════════════════════════════

class PluginRegistry {
  constructor() {
    this._mappers    = new Map();
    this._generators = new Map();
    this._hooks      = { beforeParse: [], afterParse: [] };
  }

  // ─── Mappers ────────────────────────────────────────────────────────────────

  registerMapper(key, fn, { override = false } = {}) {
    if (this._mappers.has(key) && !override) {
      throw new Error(`Un mapper "${key}" existe déjà. Utilisez { override: true } pour le remplacer.`);
    }
    if (typeof fn !== 'function') throw new TypeError(`Le mapper "${key}" doit être une fonction.`);
    this._mappers.set(key, fn);
    return this;
  }

  getMappers() { return this._mappers; }

  // ─── Générateurs ────────────────────────────────────────────────────────────

  registerGenerator(format, Generator) {
    if (typeof Generator !== 'function' || typeof Generator.prototype.generate !== 'function') {
      throw new TypeError(`Le générateur "${format}" doit être une classe avec une méthode generate().`);
    }
    this._generators.set(format, Generator);
    return this;
  }

  getGenerators() { return this._generators; }

  // ─── Hooks ──────────────────────────────────────────────────────────────────

  /** @param {Function} fn  (yamlString: string) => string */
  onBeforeParse(fn) { this._hooks.beforeParse.push(fn); return this; }

  /** @param {Function} fn  (parsed: ParsedStylesheet) => ParsedStylesheet */
  onAfterParse(fn)  { this._hooks.afterParse.push(fn);  return this; }

  applyBeforeParse(yaml) { return this._hooks.beforeParse.reduce((s, fn) => fn(s), yaml); }
  applyAfterParse(parsed){ return this._hooks.afterParse.reduce((p, fn) => fn(p), parsed); }

  // ─── Plugin bundle ──────────────────────────────────────────────────────────

  /**
   * Charge un plugin complet :
   * { name, mappers: { key: fn }, generators: { fmt: Gen }, hooks: { beforeParse, afterParse } }
   */
  use(plugin) {
    if (!plugin || !plugin.name) throw new Error('Un plugin doit avoir une propriété "name".');
    for (const [key, fn] of Object.entries(plugin.mappers    ?? {})) this.registerMapper(key, fn, { override: true });
    for (const [fmt, Gen] of Object.entries(plugin.generators ?? {})) this.registerGenerator(fmt, Gen);
    if (plugin.hooks?.beforeParse) this.onBeforeParse(plugin.hooks.beforeParse);
    if (plugin.hooks?.afterParse)  this.onAfterParse(plugin.hooks.afterParse);
    return this;
  }

  reset() {
    this._mappers.clear();
    this._generators.clear();
    this._hooks = { beforeParse: [], afterParse: [] };
    return this;
  }
}

// Singleton partagé dans tout le module
const registry = new PluginRegistry();

// ══════════════════════════════════════════════════════════════════════════════
// Importer
// Résout les directives `@import` dans les fichiers .ycss avant le parsing YAML.
//
//   # @import "./tokens.ycss"
//
// Fusionne récursivement les blocs `variables` et `components`.
// Le fichier principal a priorité sur les imports.
// ══════════════════════════════════════════════════════════════════════════════

class Importer {
  constructor() {
    this._visited = new Set();
  }

  /** Charge un fichier .ycss en résolvant tous ses imports récursivement. */
  load(filePath) {
    this._visited.clear();
    return this._loadFile(path.resolve(filePath));
  }

  /** Même chose depuis une chaîne YAML. */
  loadString(yamlString, baseDir = process.cwd()) {
    this._visited.clear();
    return this._loadString(yamlString, baseDir, '<string>');
  }

  // ─── Interne ─────────────────────────────────────────────────────────────────

  _loadFile(absPath) {
    if (this._visited.has(absPath)) throw new Error(`Import circulaire détecté: ${absPath}`);
    this._visited.add(absPath);
    if (!fs.existsSync(absPath))   throw new Error(`Fichier importé introuvable: ${absPath}`);
    const raw = fs.readFileSync(absPath, 'utf8');
    return this._loadString(raw, path.dirname(absPath), absPath);
  }

  _loadString(raw, baseDir, source) {
    const importPaths  = this._extractImports(raw);
    const preprocessed = this._quoteAtValues(this._stripImports(raw));
    this._checkDuplicateKeys(preprocessed, source);

    let doc;
    try {
      doc = yaml.load(preprocessed) ?? {};
    } catch (err) {
      throw new Error(`YAML invalide dans ${source}: ${err.message}`);
    }

    let merged = { variables: doc.variables ?? {}, components: doc.components ?? {} };

    for (const importPath of importPaths) {
      const imported = this._loadFile(path.resolve(baseDir, importPath));
      merged = this._merge(imported, merged); // fichier courant gagne
    }

    return { ...merged, source };
  }

  _checkDuplicateKeys(raw, source) {
    const KEY_RE = /^( {2})([A-Za-z_#.][A-Za-z0-9_#.\-]*):\s*$/gm;
    const seen = new Set();
    let m;
    while ((m = KEY_RE.exec(raw)) !== null) {
      if (seen.has(m[2])) {
        throw new Error(
          `Clé dupliquée "${m[2]}" dans ${source}. ` +
          `Utilisez "type: id" ou "type: class" sur une clé unique, ` +
          `ou les préfixes "#${m[2]}" / ".${m[2]}".`
        );
      }
      seen.add(m[2]);
    }
  }

  /**
   * Quote les tokens @ pour les rendre valides en YAML.
   *   @tutu:           →  "@tutu":
   *   extends: @tutu   →  extends: "@tutu"
   */
  _quoteAtValues(raw) {
    let result = raw.replace(/^(\s*)(?!")(@[\w-]+)(\s*:)/gm, '$1"$2"$3');
    result = result.replace(/^(\s*[\w-]+\s*:\s*)(?!")(@[\w-]+)(\s*(?:#.*)?)$/gm, '$1"$2"$3');
    return result;
  }

  _extractImports(raw) {
    const re = /^#\s*@import\s+"([^"]+)"/gm;
    const paths = [];
    let m;
    while ((m = re.exec(raw)) !== null) paths.push(m[1]);
    return paths;
  }

  _stripImports(raw) {
    return raw.replace(/^#\s*@import\s+"[^"]+"\s*$/gm, '');
  }

  _merge(base, override) {
    return {
      variables:  { ...base.variables,  ...override.variables  },
      components: { ...base.components, ...override.components },
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Linter
// Analyse un fichier .ycss et retourne une liste de diagnostics.
//
// Chaque diagnostic : { severity, code, message, path }
// ══════════════════════════════════════════════════════════════════════════════

class Linter {
  constructor() {
    this.diagnostics = [];
  }

  /** @returns {{ ok: boolean, diagnostics: Diagnostic[] }} */
  lint(yamlString) {
    this.diagnostics = [];
    let doc;

    try {
      doc = yaml.load(yamlString);
    } catch (err) {
      this._error('yaml-parse', err.message, '<root>');
      return this._result();
    }

    if (!doc || typeof doc !== 'object') {
      this._error('empty-file', 'Le fichier est vide ou invalide.', '<root>');
      return this._result();
    }

    this._lintVariables(doc.variables  ?? {});
    this._lintComponents(doc.components ?? {}, doc.variables ?? {});
    return this._result();
  }

  // ─── Variables ──────────────────────────────────────────────────────────────

  _lintVariables(variables) {
    for (const [name, value] of Object.entries(variables)) {
      const p = `variables.${name}`;
      if (typeof value !== 'string') {
        this._error('token-not-string', `La valeur du token doit être une chaîne, reçu: ${typeof value}`, p);
        continue;
      }
      if (/^#[0-9a-fA-F]{3,8}$/.test(value) === false && value.startsWith('#')) {
        this._warn('invalid-color', `Couleur hex suspecte: "${value}"`, p);
      }
      if (/\s/.test(name)) {
        this._error('token-whitespace', `Le nom du token ne doit pas contenir d'espaces.`, p);
      }
    }
  }

  // ─── Components ─────────────────────────────────────────────────────────────

  _lintComponents(components, variables) {
    const names = Object.keys(components);
    for (const [name, def] of Object.entries(components)) {
      const p = `components.${name}`;
      if (!def || typeof def !== 'object') {
        this._error('component-not-object', `Le composant doit être un objet.`, p); continue;
      }
      if (def.extends !== undefined) {
        if (!components[def.extends]) this._error('unknown-extends', `"${name}" étend "${def.extends}" qui n'existe pas.`, `${p}.extends`);
        if (def.extends === name)     this._error('self-extends', `Un composant ne peut pas s'étendre lui-même.`, `${p}.extends`);
      }
      this._lintProps(def, p, variables, names);
      if (def.states) this._lintStates(def.states, p, variables);
    }
  }

  _lintProps(def, basePath, variables, componentNames) {
    const KNOWN_INTENTS = new Set([
      'layout', 'center', 'padding', 'gap', 'background', 'radius', 'shadow',
      'cursor', 'transition', 'transform', 'width', 'height', 'display',
      'margin-top', 'margin-bottom', 'size', 'weight', 'color', 'extends', 'states',
    ]);
    const CSS_KEYWORDS = new Set([
      'row', 'column', 'pointer', 'none', 'auto', 'bold', 'normal', 'semibold',
      'light', 'true', 'false', 'center', 'pill', 'rounded', 'soft', 'medium',
      'inline-flex', 'flex', 'inherit', 'initial', 'unset', 'revert',
    ]);

    for (const [key, value] of Object.entries(def)) {
      const p = `${basePath}.${key}`;
      if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
        if (key !== 'states') this._lintProps(value, p, variables, componentNames);
        continue;
      }
      if (!KNOWN_INTENTS.has(key)) {
        const result = mapProperty(key, value);
        if (Object.keys(result).length === 0) this._warn('unknown-intent', `Clé inconnue "${key}" — transmise telle quelle au CSS.`, p);
      }
      if (typeof value === 'string' && variables && !(value in variables)) {
        if (/^[a-z][a-z0-9-]+$/.test(value) && !value.includes(' ') && value.length > 2 && !CSS_KEYWORDS.has(value)) {
          this._info('possible-missing-token', `"${value}" ressemble à un token mais n'est pas déclaré dans variables.`, p);
        }
      }
      if (key === 'layout' && !['row', 'column'].includes(value)) {
        this._error('invalid-layout', `layout doit être "row" ou "column", reçu: "${value}"`, p);
      }
      if (key === 'weight' && !['bold', 'semibold', 'normal', 'light'].includes(value) && isNaN(Number(value))) {
        this._warn('unknown-weight', `weight "${value}" inconnu. Valeurs: bold, semibold, normal, light.`, p);
      }
    }
  }

  _lintStates(states, basePath, variables) {
    const KNOWN_STATES = new Set(['hover', 'focus', 'active', 'disabled', 'focus-within', 'focus-visible', 'checked', 'placeholder']);
    for (const [state, props] of Object.entries(states)) {
      const p = `${basePath}.states.${state}`;
      if (!KNOWN_STATES.has(state)) this._warn('unknown-state', `État "${state}" inhabituel — vérifiez la syntaxe CSS.`, p);
      if (props && typeof props === 'object') this._lintProps(props, p, variables, []);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _error(code, message, path) { this.diagnostics.push({ severity: 'error',   code, message, path }); }
  _warn(code, message, path)  { this.diagnostics.push({ severity: 'warning',  code, message, path }); }
  _info(code, message, path)  { this.diagnostics.push({ severity: 'info',     code, message, path }); }
  _result() {
    return { ok: !this.diagnostics.some(d => d.severity === 'error'), diagnostics: this.diagnostics };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// StyleParser
// Parse un fichier .ycss et retourne une structure normalisée
// { source, variables, components } prête pour les générateurs.
// ══════════════════════════════════════════════════════════════════════════════

// Clés structurelles d'un bloc composant ou enfant — tout le reste est un enfant
const STRUCTURAL_KEYS = new Set(['style', 'extends', 'states', 'media']);

class StyleParser {
  constructor() {
    this.variables     = {};
    this.rawComponents = {};
    this.resolver      = null;
  }

  parseFile(filePath) {
    const absolute = path.resolve(filePath);
    if (!fs.existsSync(absolute)) throw new Error(`File not found: ${absolute}`);
    const importer = new Importer();
    const { variables, components, source } = importer.load(absolute);
    const raw     = importer._quoteAtValues(fs.readFileSync(absolute, 'utf8'));
    const rawYaml = yaml.load(raw) ?? {};
    return this._build(variables, components, source, rawYaml.extends ?? {});
  }

  parseString(yamlString, source = '<string>') {
    const processed = registry.applyBeforeParse(yamlString);
    const importer  = new Importer();
    const { variables, components } = importer.loadString(processed);
    const rawYaml = yaml.load(importer._quoteAtValues(processed)) ?? {};
    return this._build(variables, components, source, rawYaml.extends ?? {});
  }

  // ─── Build ─────────────────────────────────────────────────────────────────

  _build(variables, components, source, extendsSection = {}) {
    this.variables = variables;
    this.resolver  = new TokenResolver(variables);
    const merged   = { ...components };
    for (const [key, value] of Object.entries(extendsSection)) {
      const k = key.startsWith('@') ? key : `@${key}`;
      if (!(k in merged)) merged[k] = value;
    }
    this.rawComponents = merged;
    const resolved = this._resolveAll();
    return registry.applyAfterParse({ source, variables, components: resolved });
  }

  _resolveAll() {
    const components = {};
    for (const [rawKey, def] of Object.entries(this.rawComponents)) {
      const { name, selectorType, shared } = this._parseName(rawKey, def);
      if (shared) continue;
      components[rawKey] = this._resolveComponent(name, selectorType, shared, def);
    }
    return components;
  }

  _parseName(rawKey, def = {}) {
    if (rawKey.startsWith('@')) {
      const selectorTypeVal = def.style?.type;
      return { name: rawKey.slice(1), selectorType: selectorTypeVal === 'id' ? 'id' : 'class', shared: true };
    }
    if (rawKey.startsWith('#')) return { name: rawKey.slice(1), selectorType: 'id',    shared: false };
    if (rawKey.startsWith('.')) return { name: rawKey.slice(1), selectorType: 'class', shared: false };
    const selectorTypeVal = def.style?.type ?? def.type;
    if (selectorTypeVal === 'id')    return { name: rawKey, selectorType: 'id',    shared: false };
    if (selectorTypeVal === 'class') return { name: rawKey, selectorType: 'class', shared: false };
    return { name: rawKey, selectorType: 'class', shared: false };
  }

  _resolveComponent(name, selectorType, shared, def) {
    const merged   = this._applyExtends(def);
    const css      = this._extractCSS(merged);
    const states   = this._extractStates(merged);
    const media    = this._extractMedia(merged);
    const children = this._extractChildren(merged);
    return { name, selectorType, shared, css, states, media, children };
  }

  // ─── Extends ───────────────────────────────────────────────────────────────

  _applyExtends(def) {
    if (!def.extends) return def;
    const refKey = def.extends;
    const parent =
      this.rawComponents[refKey] ??
      this.rawComponents[`@${refKey}`] ??
      this.rawComponents[`.${refKey}`] ??
      this.rawComponents[`#${refKey}`];
    if (!parent) throw new Error(`extends: unknown component "${refKey}"`);
    const resolvedParent = this._applyExtends(parent);
    return { ...def, style: this._deepMerge(resolvedParent.style ?? {}, def.style ?? {}) };
  }

  // ─── Group flattening ──────────────────────────────────────────────────────

  _flattenGroups(styleProps) {
    const { groupNames } = groupLoader.load();
    const groupNameSet   = new Set(groupNames);
    const flat = {};
    for (const [key, value] of Object.entries(styleProps)) {
      if (groupNameSet.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(flat, value);
      } else {
        flat[key] = value;
      }
    }
    return flat;
  }

  // ─── CSS / States / Media / Children ──────────────────────────────────────

  _extractCSS(def) {
    const flat  = this._flattenGroups(def.style ?? {});
    const plain = {};
    for (const [key, value] of Object.entries(flat)) {
      if (RESERVED_KEYS.has(key) || key === 'type' || key === 'extends') continue;
      plain[key] = this.resolver.resolve(value);
    }
    return this._mapWithPlugins(plain);
  }

  _extractStates(def) {
    if (!def.states) return {};
    const result = {};
    for (const [state, stateBlock] of Object.entries(def.states)) {
      const styleProps = stateBlock?.style ?? stateBlock ?? {};
      result[state] = this._mapWithPlugins(this.resolver.resolveProps(this._flattenGroups(styleProps)));
    }
    return result;
  }

  _extractMedia(def) {
    if (!def.media || typeof def.media !== 'object') return {};
    const result = {};
    for (const [query, block] of Object.entries(def.media)) {
      if (!block || typeof block !== 'object') continue;
      const styleBlock  = block.style ?? {};
      const statesBlock = block.states;
      const legacyProps = Object.fromEntries(Object.entries(block).filter(([k]) => k !== 'style' && k !== 'states'));
      const css         = this._mapWithPlugins(this.resolver.resolveProps(this._flattenGroups({ ...legacyProps, ...styleBlock })));
      const states      = {};
      if (statesBlock) {
        for (const [state, stateBlock] of Object.entries(statesBlock)) {
          const styleProps = stateBlock?.style ?? stateBlock ?? {};
          states[state] = this._mapWithPlugins(this.resolver.resolveProps(this._flattenGroups(styleProps)));
        }
      }
      result[query] = { css, states };
    }
    return result;
  }

  _extractChildren(def) {
    const children = {};
    for (const [key, value] of Object.entries(def)) {
      if (STRUCTURAL_KEYS.has(key)) continue;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const resolved   = this._applyExtends(value);
      const flat       = this._flattenGroups(resolved.style ?? {});
      const { states: childStates, media: childMedia } = resolved;
      const plainAttrs = {};
      for (const [k, v] of Object.entries(flat)) {
        if (k === 'type' || k === 'extends' || RESERVED_KEYS.has(k)) continue;
        plainAttrs[k] = this.resolver.resolve(v);
      }
      const css      = this._mapWithPlugins(plainAttrs);
      const statesCss = {};
      if (childStates && typeof childStates === 'object') {
        for (const [state, stateBlock] of Object.entries(childStates)) {
          const styleProps = stateBlock?.style ?? stateBlock ?? {};
          statesCss[state] = this._mapWithPlugins(this.resolver.resolveProps(this._flattenGroups(styleProps)));
        }
      }
      const media = {};
      if (childMedia && typeof childMedia === 'object') {
        for (const [query, block] of Object.entries(childMedia)) {
          if (!block || typeof block !== 'object') continue;
          const styleBlock  = block.style ?? {};
          const legacyProps = Object.fromEntries(Object.entries(block).filter(([k]) => k !== 'style' && k !== 'states'));
          media[query] = { css: this._mapWithPlugins(this.resolver.resolveProps(this._flattenGroups({ ...legacyProps, ...styleBlock }))) };
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
      Object.assign(css, customMappers.has(key) ? customMappers.get(key)(value) : mapProperty(key, value));
    }
    return css;
  }

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

module.exports = {
  PluginRegistry,
  registry,
  Importer,
  Linter,
  StyleParser,
};
