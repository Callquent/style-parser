'use strict';

const fs  = require('fs');
const path = require('path');
const css  = require('css');

const { loader: groupLoader } = require('./core');

// Clés qui ne vont jamais dans attrs:
const STRUCTURAL_KEYS = new Set(['extends', 'states', 'selectors', 'media']);
// (type est désormais émis directement sur le bloc composant, pas dans attrs:)

class CSSConverter {

  convertFile(filePath) {
    const abs  = path.resolve(filePath);
    const text = fs.readFileSync(abs, 'utf8');
    const ext  = path.extname(abs).toLowerCase();
    if (ext === '.less') {
      const LessConverter = require('./generators/less');
      return this.convertString(new LessConverter().convert(text));
    }
    return this.convertString(text);
  }

  convertString(cssText) {
    return this._toStyleFile(this._convert(cssText));
  }

  // ─── Group bucketing ────────────────────────────────────────────────────────

  /**
   * Range les propriétés plates dans leurs groupes selon ycss-groups.yaml.
   * Retourne { type?, <group>?: {}, … }
   *
   * Les groupes sont lus dynamiquement depuis GroupLoader : ajouter/déplacer
   * une propriété dans ycss-groups.yaml suffit pour changer le bucketing.
   */
  _groupProps(props) {
    const { groupNames, propToGroup } = groupLoader.load();

    // Initialise les buckets dans l'ordre du fichier YAML
    const buckets = {};
    for (const g of groupNames) buckets[g] = {};
    const rest = {};

    for (const [k, v] of Object.entries(props)) {
      const groupName = propToGroup.get(k);
      if (groupName) {
        buckets[groupName][k] = v;
      } else {
        rest[k] = v;
      }
    }

    const grouped = {};
    for (const [g, p] of Object.entries(buckets)) {
      if (!Object.keys(p).length) continue;
      grouped[g] = p;
    }
    // scalaires hors-groupe AVANT les groupes
    return { ...rest, ...grouped };
  }

  // ─── Reverse property mapper ────────────────────────────────────────────────

  _reverseMap(decls) {
    const d = { ...decls }, out = {};
    // display:flex/inline-flex → layout intent
    if (d['display'] === 'flex' || d['display'] === 'inline-flex') {
      if (d['display'] === 'inline-flex') out['display'] = 'inline-flex';
      out['layout'] = (d['flex-direction'] ?? 'row') === 'column' ? 'column' : 'row';
      delete d['display']; delete d['flex-direction'];
      if (d['align-items'] === 'center' && d['justify-content'] === 'center') {
        out['center'] = true;
        delete d['align-items']; delete d['justify-content'];
      }
    }
    // display non-flex reste comme scalaire dans leftovers (hors-groupe → devant les groupes)

    // padding
    if (d['padding'])               { out['padding']         = d['padding'];               delete d['padding']; }
    if (d['padding-top'])           { out['padding-top']     = d['padding-top'];           delete d['padding-top']; }
    if (d['padding-right'])         { out['padding-right']   = d['padding-right'];         delete d['padding-right']; }
    if (d['padding-bottom'])        { out['padding-bottom']  = d['padding-bottom'];        delete d['padding-bottom']; }
    if (d['padding-left'])          { out['padding-left']    = d['padding-left'];          delete d['padding-left']; }
    // margin
    if (d['margin'])                { out['margin']          = d['margin'];                delete d['margin']; }
    if (d['margin-top'])            { out['margin-top']      = d['margin-top'];            delete d['margin-top']; }
    if (d['margin-right'])          { out['margin-right']    = d['margin-right'];          delete d['margin-right']; }
    if (d['margin-bottom'])         { out['margin-bottom']   = d['margin-bottom'];         delete d['margin-bottom']; }
    if (d['margin-left'])           { out['margin-left']     = d['margin-left'];           delete d['margin-left']; }
    // sizing
    if (d['width'])                 { out['width']           = d['width'];                 delete d['width']; }
    if (d['height'])                { out['height']          = d['height'];                delete d['height']; }
    if (d['min-width'])             { out['min-width']       = d['min-width'];             delete d['min-width']; }
    if (d['max-width'])             { out['max-width']       = d['max-width'];             delete d['max-width']; }
    if (d['min-height'])            { out['min-height']      = d['min-height'];            delete d['min-height']; }
    if (d['max-height'])            { out['max-height']      = d['max-height'];            delete d['max-height']; }
    // gap
    if (d['gap'])                   { out['gap']             = d['gap'];                   delete d['gap']; }
    // border → box group (kept as-is, border-radius aliased to radius)
    if (d['border'])                { out['border']          = d['border'];                delete d['border']; }
    if (d['border-top'])            { out['border-top']      = d['border-top'];            delete d['border-top']; }
    if (d['border-right'])          { out['border-right']    = d['border-right'];          delete d['border-right']; }
    if (d['border-bottom'])         { out['border-bottom']   = d['border-bottom'];         delete d['border-bottom']; }
    if (d['border-left'])           { out['border-left']     = d['border-left'];           delete d['border-left']; }
    if (d['border-color'])          { out['border-color']    = d['border-color'];          delete d['border-color']; }
    if (d['border-width'])          { out['border-width']    = d['border-width'];          delete d['border-width']; }
    if (d['border-style'])          { out['border-style']    = d['border-style'];          delete d['border-style']; }
    if (d['border-radius'])         { out['radius']          = d['border-radius'];         delete d['border-radius']; }
    if (d['border-top-left-radius'])     { out['border-top-left-radius']     = d['border-top-left-radius'];     delete d['border-top-left-radius']; }
    if (d['border-top-right-radius'])    { out['border-top-right-radius']    = d['border-top-right-radius'];    delete d['border-top-right-radius']; }
    if (d['border-bottom-left-radius'])  { out['border-bottom-left-radius']  = d['border-bottom-left-radius'];  delete d['border-bottom-left-radius']; }
    if (d['border-bottom-right-radius']) { out['border-bottom-right-radius'] = d['border-bottom-right-radius']; delete d['border-bottom-right-radius']; }
    // shadow
    if (d['box-shadow'])            { out['shadow']          = d['box-shadow'];            delete d['box-shadow']; }
    // uiProps
    if (d['background'])            { out['background']       = d['background'];       delete d['background']; }
    if (d['background-color'])      { out['background']       = d['background-color']; delete d['background-color']; }
    if (d['background-image'])      { out['background-image'] = d['background-image']; delete d['background-image']; }
    if (d['color'])                 { out['color']            = d['color'];            delete d['color']; }
    // interactions
    if (d['cursor'])                { out['cursor']          = d['cursor'];                delete d['cursor']; }
    if (d['transition'])            { out['transition']      = d['transition'];            delete d['transition']; }
    if (d['transform'])             { out['transform']       = d['transform'];             delete d['transform']; }
    // position
    if (d['position'])              { out['position']        = d['position'];              delete d['position']; }
    if (d['top'])                   { out['top']             = d['top'];                   delete d['top']; }
    if (d['right'])                 { out['right']           = d['right'];                 delete d['right']; }
    if (d['bottom'])                { out['bottom']          = d['bottom'];                delete d['bottom']; }
    if (d['left'])                  { out['left']            = d['left'];                  delete d['left']; }
    if (d['z-index'])               { out['z-index']         = d['z-index'];               delete d['z-index']; }
    // typo
    if (d['font-size'])             { out['size']            = d['font-size'];             delete d['font-size']; }
    if (d['font-weight'])           { out['weight']          = this._wl(d['font-weight']); delete d['font-weight']; }
    if (d['font-style'])            { out['font-style']      = d['font-style'];            delete d['font-style']; }
    return { intents: out, leftovers: d };
  }

  _wl(v) {
    const map = { '700':'bold','600':'semibold','400':'normal','300':'light',
                  bold:'bold',semibold:'semibold',normal:'normal',light:'light' };
    return map[v] ?? v;
  }

  // ─── Selector parser ────────────────────────────────────────────────────────

  /**
   * Normalise un segment de sélecteur en { name, selectorType }.
   *
   * Gère :
   *   - Sélecteurs d'attribut  : input[type="checkbox"]  → { name:'input', selectorType:'tag' }
   *   - Multi-class             : .foo.bar                → { name:'foo', selectorType:'class' }
   *   - ::pseudo-element        : stripped avant d'arriver ici
   *   - :pseudo-class avec args : .foo:not(.x)            → { name:'foo', ... }
   *   - tag + class             : div.foo                 → { name:'foo', selectorType:'class' }
   */
  _normalizePart(part) {
    // Strip attribute selectors like [type="checkbox"], [for="..."]
    part = part.replace(/\[[^\]]*\]/g, '').trim();
    if (!part) return null;

    // Strip ::pseudo-element (::after, ::before, ::first-letter…)
    part = part.replace(/::[\w-]+/g, '').trim();
    if (!part) return null;

    // Strip :pseudo-class with arguments (:not(...), :nth-child(...), :first-child, :last-child…)
    // Keep stripping until none remain
    part = part.replace(/:[\w-]+(\([^)]*\))?/g, '').trim();
    if (!part) return null;

    // Now parse the cleaned part
    const id = part.match(/#([\w-]+)/);  if (id)  return { name: id[1],  selectorType: 'id' };
    const cl = part.match(/\.([\w-]+)/); if (cl)  return { name: cl[1],  selectorType: 'class' };
    if (/^[a-z][a-z0-9-]*$/.test(part)) return { name: part, selectorType: 'tag' };
    return null;
  }

  _toBase(n) { return (n.selectorType === 'id' ? '#' : '.') + n.name; }

  /**
   * Charge selectors.yaml et retourne les combinateurs à normaliser (→ espace)
   * et ceux à rejeter (non listés).
   * Les combinateurs listés sous selectors.combinators sont traités comme
   * des séparateurs de descendance (normalisés en espace).
   * Le résultat est mis en cache sur l'instance.
   */
  _loadCombinators() {
    if (this._combinators) return this._combinators;
    const catMap = this._buildSelectorCategoryMap();
    // Les combinateurs listés dans selectors.yaml (clé "combinators")
    const fromYaml = new Set(
      [...catMap.entries()]
        .filter(([, cat]) => cat === 'combinators')
        .map(([name]) => name)
    );
    // Fallback : si aucune section combinators dans selectors.yaml, tous supportés
    const defaults = new Set(['>', '+', '~']);
    this._combinators = fromYaml.size ? fromYaml : defaults;
    return this._combinators;
  }

  /**
   * Charge selectors.yaml et retourne un Set des noms de pseudo-classes/éléments connus.
   * Cherche le fichier dans l'ordre :
   *   1. process.cwd()/selectors.yaml
   *   2. __dirname/selectors.yaml
   * Si introuvable, retourne le jeu de secours codé en dur.
   * Le résultat est mis en cache sur l'instance.
   */
  _loadSelectors() {
    if (this._knownPseudo) return this._knownPseudo;
    // Réutilise _buildSelectorCategoryMap comme source de vérité unique
    const catMap = this._buildSelectorCategoryMap();
    this._knownPseudo = new Set(catMap.keys());
    return this._knownPseudo;
  }

  /**
   * Parse un sélecteur CSS en une structure exploitable par le convertisseur.
   *
   * Types retournés :
   *   base        : sélecteur racine simple           (.btn)
   *   state       : sélecteur racine + pseudo-state   (.btn:hover)
   *   child       : composant + enfant                (.btn .label)
   *   child-state : composant + enfant + pseudo       (.btn .label:hover)
   *   multi       : sélecteur multiple séparé par ,
   *   complex     : trop complexe pour être mappé (sibling +, * universel, etc.)
   *
   * Pseudo-states extraits depuis la fin du sélecteur nettoyé :
   *   :hover, :focus, :active, :checked, :before, :after, :placeholder,
   *   :disabled, :focus-within, :focus-visible, :first-child, :last-child, etc.
   * Les ::pseudo-elements (::after) sont normalisés en :after / :before.
   */
  _parseSelector(rawSel) {
    let sel = rawSel.trim();
    if (sel.includes(',')) return { type: 'multi', parts: sel.split(',').map(s => s.trim()) };

    // Reject universal selector (*) — unmappable in all cases
    if (/(?:^|\s)\*(?:\s|$|\[|:)/.test(sel)) return { type: 'complex', raw: rawSel };

    // Load supported combinators from selectors.yaml
    const combinators = this._loadCombinators();

    // Build a regex that matches any combinator NOT in the supported set
    // Supported combinators are normalized to a space (descendant semantics)
    const ALL_COMBINATORS = ['>', '+', '~'];
    const unsupported = ALL_COMBINATORS.filter(c => !combinators.has(c));

    // Tous les combinateurs supportés (+, ~, >) produisent { type: 'combinator' }
    for (const c of ALL_COMBINATORS.filter(cv => combinators.has(cv))) {
      const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?:^|[^\\[])\\s*${escaped}\\s*`).test(sel)) {
        return { type: 'combinator', combinator: c, raw: rawSel };
      }
    }

    // Rejeter les combinateurs non supportés
    for (const c of unsupported) {
      const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\s*${escaped}\\s*`).test(sel)) {
        return { type: 'complex', raw: rawSel };
      }
    }


    // Extract trailing pseudo-state or pseudo-element
    // We look at the ORIGINAL (pre-strip) selector for the last pseudo
    let state = null;

    // ::pseudo-element at the end  →  state = 'after' / 'before' / etc.
    const pem = sel.match(/::([a-z-]+)$/i);
    if (pem) {
      state = pem[1];
      sel   = sel.slice(0, sel.lastIndexOf('::' + pem[1])).trim();
    }

    // :pseudo-class at the end (only simple ones without args, or :checked/:before/:after)
    if (!state) {
      const pcm = sel.match(/:([a-z-]+)(?:\([^)]*\))?$/i);
      if (pcm) {
        const pseudo = pcm[1];
        const full   = pcm[0]; // includes possible (...)
        const before = sel.slice(0, sel.lastIndexOf(full));
        // Only extract if what's before isn't empty and pseudo is a known state/element
        const KNOWN_PSEUDO = this._loadSelectors();
        if (KNOWN_PSEUDO.has(pseudo) && before.trim()) {
          state = pseudo;
          sel   = before.trim();
        }
      }
    }

    // Split on whitespace into parts, then normalize each
    const rawParts = sel.split(/\s+/).filter(Boolean);
    if (!rawParts.length) return { type: 'complex', raw: rawSel };
    const parts = rawParts.map(p => this._normalizePart(p));
    if (parts.some(p => p === null)) return { type: 'complex', raw: rawSel };

    if (parts.length === 1) {
      const b = this._toBase(parts[0]);
      return state ? { type: 'state', base: b, state } : { type: 'base', base: b };
    }
    if (parts.length === 2) {
      const b = this._toBase(parts[0]), c = parts[1].name;
      return state ? { type: 'child-state', base: b, child: c, state } : { type: 'child', base: b, child: c };
    }
    const b = this._toBase(parts[0]), c = parts[parts.length - 1].name;
    return state
      ? { type: 'child-state', base: b, child: c, state, approx: true }
      : { type: 'child',       base: b, child: c,         approx: true };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  _declsToMap(declarations = []) {
    const map = {};
    for (const d of declarations) {
      if (d.type === 'declaration')
        map[d.property] = (d.value ?? '').replace(/\s*!important/, '').trim();
    }
    return map;
  }

  _extractTokens(components) {
    const COLOR_RE      = /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^hsl/;
    const URL_RE        = /^url\s*\(/i;
    const SPACING_RE    = /^(\d+(?:\.\d+)?)(px|rem|em)$/;
    const SIZE_LABELS   = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
    const RADIUS_LABELS = ['sm', 'md', 'lg', 'pill'];

    // CSS property → bucket name
    const PROP_TO_BUCKET = {
      'background':         'color',
      'background-color':   'color',
      'color':              'color',
      'border-color':       'color',
      'outline-color':      'color',
      'fill':               'color',
      'font-size':          'fontSize',
      'border-radius':      'radius',
      'box-shadow':         'shadow',
      'transition':         'transition',
      'font-family':        'family',
      'padding':            'spacing',
      'gap':                'spacing',
      'margin':             'spacing',
      'margin-top':         'spacing',
      'margin-bottom':      'spacing',
      'margin-left':        'spacing',
      'margin-right':       'spacing',
      'width':              'spacing',
      'height':             'spacing',
    };

    // ── Helpers ───────────────────────────────────────────────────────────────

    const makeBuckets = () => ({
      color: new Map(), image: new Map(), spacing: new Map(), fontSize: new Map(),
      radius: new Map(), shadow: new Map(), transition: new Map(), family: new Map(),
    });

    /** Recursive property-aware scan into a bucket set. */
    const scanInto = (o, buckets, propKey = null) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string') {
          // url(...) values are always images, never colors
          if (URL_RE.test(v)) {
            buckets.image.set(v, (buckets.image.get(v) ?? 0) + 1);
            continue;
          }
          const bn = PROP_TO_BUCKET[k] ?? PROP_TO_BUCKET[propKey];
          if (bn) {
            buckets[bn].set(v, (buckets[bn].get(v) ?? 0) + 1);
          } else if (COLOR_RE.test(v)) {
            buckets.color.set(v, (buckets.color.get(v) ?? 0) + 1);
          }
        } else {
          scanInto(v, buckets, k);
        }
      }
    };

    /** Build a named token map from frequency buckets. */
    const buildTokens = (buckets, minCount = 2) => {
      const tokens = {};
      let ci = 1;
      for (const [v, n] of buckets.color)
        if (n >= minCount) tokens[`color-${ci++}`] = v;

      let ii = 1;
      for (const [v, n] of buckets.image)
        if (n >= minCount) tokens[`image-${ii++}`] = v;

      [...buckets.fontSize.entries()]
        .filter(([, n]) => n >= minCount)
        .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
        .forEach(([v], i) => { tokens[`font-size-${SIZE_LABELS[i] ?? i + 1}`] = v; });

      [...buckets.spacing.entries()]
        .filter(([v, n]) => n >= minCount && SPACING_RE.test(v))
        .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
        .forEach(([v], i) => { tokens[`spacing-${SIZE_LABELS[i] ?? i + 1}`] = v; });

      [...buckets.radius.entries()]
        .filter(([, n]) => n >= minCount)
        .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
        .forEach(([v], i) => { tokens[`radius-${RADIUS_LABELS[i] ?? i + 1}`] = v; });

      let si = 1, ti = 1, fi = 1;
      for (const [v, n] of buckets.shadow)     if (n >= minCount) tokens[`shadow-${si++}`]      = v;
      for (const [v, n] of buckets.transition)  if (n >= minCount) tokens[`transition-${ti++}`]  = v;
      for (const [v, n] of buckets.family)      if (n >= minCount) tokens[`font-family-${fi++}`] = v;

      return tokens;
    };

    // ── Base tokens (scan everything except media blocks) ─────────────────────
    const baseBuckets = makeBuckets();
    for (const comp of Object.values(components)) {
      const { media: _ignored, ...rest } = comp;
      scanInto(rest, baseBuckets);
    }
    const base = buildTokens(baseBuckets, 2);

    // ── Media query overrides (per-query scan, same naming, diff values only) ─
    const mediaBucketsByQuery = new Map();
    for (const comp of Object.values(components)) {
      for (const [query, mqBlock] of Object.entries(comp.media ?? {})) {
        if (!mediaBucketsByQuery.has(query)) mediaBucketsByQuery.set(query, makeBuckets());
        scanInto(mqBlock, mediaBucketsByQuery.get(query));
      }
    }

    // ── Name each media query as a breakpoint token ───────────────────────────
    const _nameBreakpoint = (query) => {
      const maxPx = query.match(/max-width\s*:\s*(\d+)/i);
      if (maxPx) return `breakpoint-mobile-${maxPx[1]}`;
      const minPx = query.match(/min-width\s*:\s*(\d+)/i);
      if (minPx) return `breakpoint-desktop-${minPx[1]}`;
      return null; // fallback handled below
    };

    // breakpoints: { 'breakpoint-mobile-768': '(max-width: 768px)', … }
    const breakpoints = {};
    let bpCounter = 1;
    for (const query of mediaBucketsByQuery.keys()) {
      const name = _nameBreakpoint(query) ?? `breakpoint-${bpCounter++}`;
      breakpoints[name] = query;
    }

    // media: keyed by breakpoint token name, not raw query string
    const media = {};
    for (const [query, buckets] of mediaBucketsByQuery) {
      const bpName   = Object.keys(breakpoints).find(k => breakpoints[k] === query) ?? query;
      const mqTokens = buildTokens(buckets, 2);
      const overrides = Object.fromEntries(
        Object.entries(mqTokens).filter(([name, value]) => base[name] !== value)
      );
      if (Object.keys(overrides).length) media[bpName] = overrides;
    }

    return { base, breakpoints, media };
  }

  _subTokens(obj, m) {
    if (!obj || typeof obj !== 'object') return obj;
    const o = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && m.has(v)) o[k] = m.get(v);
      else if (typeof v === 'object')         o[k] = this._subTokens(v, m);
      else                                    o[k] = v;
    }
    return o;
  }

  // ─── Core conversion ────────────────────────────────────────────────────────

  _convert(cssText) {
    const ast = css.parse(cssText, { silent: true });
    const components = {}, skipped = [], combinatorsMap = [];

    const gc = k => {
      if (!components[k]) components[k] = { base: {}, states: {}, children: {}, childStates: {}, media: {} };
      return components[k];
    };

    const pr = (rule, mq = null) => {
      const rd = this._declsToMap(rule.declarations);
      if (!Object.keys(rd).length) return;
      for (const rs of (rule.selectors ?? [])) {
        const p = this._parseSelector(rs);
        if (p.type === 'multi') {
          // Recurse: treat each part as an individual selector rule
          for (const part of p.parts) {
            const sub = this._parseSelector(part);
            if (sub.type === 'combinator') { combinatorsMap.push({ sel: part, combinator: sub.combinator, decls: rd }); continue; }
            if (sub.type === 'complex') { skipped.push({ sel: part, decls: rd }); continue; }
            const cs = gc(sub.base);
            if (mq) {
              cs.media[mq] ??= { base: {}, states: {}, children: {}, childStates: {} };
              if (sub.type === 'base') Object.assign(cs.media[mq].base, rd);
              else if (sub.type === 'state') { cs.media[mq].states[sub.state] ??= {}; Object.assign(cs.media[mq].states[sub.state], rd); }
              else if (sub.type === 'child') { cs.media[mq].children[sub.child] ??= {}; Object.assign(cs.media[mq].children[sub.child], rd); }
              else if (sub.type === 'child-state') {
                cs.media[mq].childStates[sub.child] ??= {}; cs.media[mq].childStates[sub.child][sub.state] ??= {};
                Object.assign(cs.media[mq].childStates[sub.child][sub.state], rd);
              }
            } else {
              if (sub.type === 'base') Object.assign(cs.base, rd);
              else if (sub.type === 'state') { cs.states[sub.state] ??= {}; Object.assign(cs.states[sub.state], rd); }
              else if (sub.type === 'child') { cs.children[sub.child] ??= {}; Object.assign(cs.children[sub.child], rd); }
              else if (sub.type === 'child-state') {
                cs.childStates[sub.child] ??= {}; cs.childStates[sub.child][sub.state] ??= {};
                Object.assign(cs.childStates[sub.child][sub.state], rd);
              }
            }
          }
          continue;
        }
        if (p.type === 'combinator') { combinatorsMap.push({ sel: rs, combinator: p.combinator, decls: rd }); continue; }
        if (p.type === 'complex') { skipped.push({ sel: rs, decls: rd }); continue; }
        const c = gc(p.base);
        if (mq) {
          c.media[mq] ??= { base: {}, states: {}, children: {}, childStates: {} };
          if (p.type === 'base') Object.assign(c.media[mq].base, rd);
          else if (p.type === 'state') { c.media[mq].states[p.state] ??= {}; Object.assign(c.media[mq].states[p.state], rd); }
          else if (p.type === 'child') { c.media[mq].children[p.child] ??= {}; Object.assign(c.media[mq].children[p.child], rd); }
          else if (p.type === 'child-state') {
            c.media[mq].childStates[p.child] ??= {}; c.media[mq].childStates[p.child][p.state] ??= {};
            Object.assign(c.media[mq].childStates[p.child][p.state], rd);
          }
        } else {
          if (p.type === 'base') Object.assign(c.base, rd);
          else if (p.type === 'state') { c.states[p.state] ??= {}; Object.assign(c.states[p.state], rd); }
          else if (p.type === 'child') { c.children[p.child] ??= {}; Object.assign(c.children[p.child], rd); }
          else if (p.type === 'child-state') {
            c.childStates[p.child] ??= {}; c.childStates[p.child][p.state] ??= {};
            Object.assign(c.childStates[p.child][p.state], rd);
          }
        }
      }
    };

    for (const n of (ast.stylesheet?.rules ?? [])) {
      if (n.type === 'rule') pr(n);
      else if (n.type === 'media') for (const i of (n.rules ?? [])) if (i.type === 'rule') pr(i, n.media);
    }

    const rt  = this._extractTokens(components);
    const tbv = new Map(Object.entries(rt.base).map(([k, v]) => [v, k]));
    const sc = {};

    for (const [sel, comp] of Object.entries(components)) {
      const isId = sel.startsWith('#'), name = sel.replace(/^[.#]/, '');
      const { intents: bi, leftovers: br } = this._reverseMap({ ...comp.base });

      // Propriétés de base → attrs:
      const selectorType = isId ? 'id' : 'class';
      const attrsProps = this._groupProps({ ...bi, ...br });
      const entry = { type: selectorType, style: attrsProps };

      // states: → sous states: (dans attrs niveau composant, pas dans attrs)
      if (Object.keys(comp.states).length) {
        entry.states = {};
        for (const [s, d] of Object.entries(comp.states)) {
          const { intents: i, leftovers: l } = this._reverseMap({ ...d });
          entry.states[s] = { style: this._groupProps({ ...i, ...l }) };
        }
      }

      // Enfants → clés au même niveau qu'attrs
      const ac = new Set([...Object.keys(comp.children), ...Object.keys(comp.childStates)]);
      for (const child of ac) {
        const { intents: i, leftovers: l } = this._reverseMap({ ...(comp.children[child] ?? {}) });
        const childEntry = { style: this._groupProps({ ...i, ...l }) };
        const cs = comp.childStates[child] ?? {};
        if (Object.keys(cs).length) {
          childEntry.states = {};
          for (const [s, d] of Object.entries(cs)) {
            const { intents: si, leftovers: sl } = this._reverseMap({ ...d });
            childEntry.states[s] = { style: this._groupProps({ ...si, ...sl }) };
          }
        }
        entry[child] = childEntry;
      }

      // media: → sous media:
      if (Object.keys(comp.media).length) {
        entry.media = {};
        // Reverse map: raw query string → breakpoint token name
        const queryToToken = Object.fromEntries(
          Object.entries(rt.breakpoints).map(([name, query]) => [query, name])
        );
        for (const [q, mb] of Object.entries(comp.media)) {
          const mediaKey = queryToToken[q] ?? q;
          const mqEntry = {};
          if (Object.keys(mb.base).length) {
            const { intents: i, leftovers: l } = this._reverseMap({ ...mb.base });
            mqEntry.style = this._groupProps({ ...i, ...l });
          }
          if (Object.keys(mb.states ?? {}).length) {
            mqEntry.states = {};
            for (const [s, d] of Object.entries(mb.states)) {
              const { intents: i, leftovers: l } = this._reverseMap({ ...d });
              mqEntry.states[s] = { style: this._groupProps({ ...i, ...l }) };
            }
          }
          // children inside media block
          const mqChildren = mb.children ?? {};
          const mqChildStates = mb.childStates ?? {};
          const mqChildNames = new Set([...Object.keys(mqChildren), ...Object.keys(mqChildStates)]);
          for (const childName of mqChildNames) {
            const { intents: ci, leftovers: cl } = this._reverseMap({ ...(mqChildren[childName] ?? {}) });
            const childMqEntry = { style: this._groupProps({ ...ci, ...cl }) };
            const cs = mqChildStates[childName] ?? {};
            if (Object.keys(cs).length) {
              childMqEntry.states = {};
              for (const [s, d] of Object.entries(cs)) {
                const { intents: si, leftovers: sl } = this._reverseMap({ ...d });
                childMqEntry.states[s] = { style: this._groupProps({ ...si, ...sl }) };
              }
            }
            mqEntry[childName] = childMqEntry;
          }
          entry.media[mediaKey] = mqEntry;
        }
      }

      sc[name] = this._subTokens(entry, tbv);
    }

    const { components: deduped, extends: sharedComps } = this._deduplicateComponents(sc);
    return { variables: rt.base, breakpoints: rt.breakpoints, mediaVariables: rt.media, extends: sharedComps, components: deduped, skipped, combinatorsMap };
  }

  // ─── Deduplication ──────────────────────────────────────────────────────────

  /**
   * Détecte les blocs d'attributs partagés entre plusieurs composants.
   *
   * Deux passes :
   *   1. Groupes par préfixe commun (btn, btn-outline, btn-sm → @btn-base)
   *   2. Groupes par similarité structurelle (login + register → @shared-N)
   *      même sans préfixe commun, si attrs + enfants se ressemblent.
   *
   * Pour chaque groupe, on calcule l'intersection :
   *   - des attrs de base
   *   - des enfants identiques (même nom + mêmes attrs)
   * Si l'intersection est non triviale, un composant @xxx-base est créé dans extends:.
   */
  _deduplicateComponents(components) {
    const MIN_SHARED = 2;
    const MIN_SCORE  = 1;

    const extendsSection    = {};
    const updatedComponents = { ...components };
    let   sharedCounter     = 1;

    // ── Passe 1 : groupes par préfixe ──────────────────────────────────────────
    const names = Object.keys(components);
    const prefixGroups = new Map();

    for (const name of names) {
      const siblings = names.filter(n => n !== name && n.startsWith(name + '-'));
      if (siblings.length >= MIN_SHARED - 1) {
        const members = [name, ...siblings];
        const key = [...members].sort().join(',');
        if (!prefixGroups.has(key)) prefixGroups.set(key, { prefix: name, members });
      }
    }

    const validPrefixGroups = [];
    for (const g of prefixGroups.values()) {
      const isSubset = validPrefixGroups.some(
        vg => g.members.every(m => vg.members.includes(m)) && vg.members.length > g.members.length
      );
      if (!isSubset) validPrefixGroups.push(g);
    }

    const assignedToGroup = new Set();

    for (const { prefix, members } of validPrefixGroups) {
      const sharedName = `@${prefix}-base`;
      const applied = this._applyGroup(members, sharedName, components, updatedComponents, extendsSection, MIN_SCORE);
      if (applied) members.forEach(m => assignedToGroup.add(m));
    }

    // ── Passe 2 : groupes par similarité structurelle ──────────────────────────
    const remaining = names.filter(n => !assignedToGroup.has(n));
    const similarGroups = this._clusterBySimilarity(remaining, components, MIN_SCORE);

    for (const members of similarGroups) {
      if (members.length < MIN_SHARED) continue;
      const commonPfx = this._commonPrefix(members);
      const sharedName = commonPfx ? `@${commonPfx}-base` : `@shared-${sharedCounter++}`;
      this._applyGroup(members, sharedName, components, updatedComponents, extendsSection, MIN_SCORE);
    }

    return { components: updatedComponents, extends: extendsSection };
  }

  /** Calcule l'intersection et crée le composant partagé si le score est suffisant. */
  _applyGroup(members, sharedName, originalComponents, updatedComponents, extendsSection, minScore) {
    const flatMaps   = members.map(m => this._flatAttrs(originalComponents[m]));
    const attrInter  = this._intersectProps(flatMaps);
    const childInter = this._intersectChildren(members, originalComponents);

    const attrScore  = Object.keys(attrInter).length;
    const childScore = Object.values(childInter).reduce((sum, c) => sum + Math.max(1, Object.keys(this._flatAttrs(c)).length), 0);

    if (attrScore + childScore < minScore) return false;

    // Construire le composant partagé
    const sharedEntry = {};
    if (attrScore > 0) {
      const { intents, leftovers } = this._reverseMap(this._unFlatAttrs(attrInter));
      sharedEntry.style = this._groupProps({ ...intents, ...leftovers });
    }
    for (const [childName, childEntry] of Object.entries(childInter)) {
      sharedEntry[childName] = childEntry;
    }
    extendsSection[sharedName] = sharedEntry;

    // Mettre à jour chaque membre
    for (const memberName of members) {
      const entry = { ...updatedComponents[memberName] };
      if (attrScore > 0) entry.style = this._subtractAttrs(entry.style ?? {}, attrInter);
      for (const childName of Object.keys(childInter)) {
        if (entry[childName] && this._childIsIdentical(entry[childName], childInter[childName])) {
          delete entry[childName];
        }
      }
      entry.extends = sharedName;
      updatedComponents[memberName] = entry;
    }

    return true;
  }

  /** Regroupe par similarité (union-find). Retourne tableau de groupes. */
  _clusterBySimilarity(names, components, minScore) {
    const parent = Object.fromEntries(names.map(n => [n, n]));
    const find = n => { while (parent[n] !== n) { parent[n] = parent[parent[n]]; n = parent[n]; } return n; };
    const union = (a, b) => { parent[find(a)] = find(b); };

    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i], b = names[j];
        const inter = this._intersectProps([this._flatAttrs(components[a]), this._flatAttrs(components[b])]);
        const childInter = this._intersectChildren([a, b], components);
        const childScore = Object.values(childInter).reduce((sum, c) => sum + Math.max(1, Object.keys(this._flatAttrs(c)).length), 0);
        if (Object.keys(inter).length + childScore >= minScore) union(a, b);
      }
    }

    const grouped = new Map();
    for (const n of names) {
      const root = find(n);
      if (!grouped.has(root)) grouped.set(root, []);
      grouped.get(root).push(n);
    }
    return [...grouped.values()].filter(g => g.length >= 2);
  }

  /** Retourne les enfants identiques dans TOUS les membres. */
  _intersectChildren(members, components) {
    if (!members.length) return {};
    const [first, ...rest] = members;
    const result = {};
    for (const [key, val] of Object.entries(components[first])) {
      if (['style', 'states', 'media', 'extends'].includes(key)) continue;
      if (typeof val !== 'object' || val === null) continue;
      if (rest.every(m => this._childIsIdentical(val, components[m]?.[key]))) {
        result[key] = val;
      }
    }
    return result;
  }

  /** Compare deux blocs enfant : mêmes attrs (plat), ignorant "type". */
  _childIsIdentical(a, b) {
    if (!a || !b) return false;
    const fa = this._flatAttrs(a), fb = this._flatAttrs(b);
    delete fa.type; delete fb.type;
    const keysA = Object.keys(fa);
    if (keysA.length !== Object.keys(fb).length) return false;
    return keysA.every(k => fa[k] === fb[k]);
  }

  /** Préfixe commun de plusieurs noms (ex: ["form-login","form-reg"] → "form"). */
  _commonPrefix(names) {
    if (!names.length) return null;
    const parts = names.map(n => n.split('-'));
    const minLen = Math.min(...parts.map(p => p.length));
    const common = [];
    for (let i = 0; i < minLen - 1; i++) {
      const seg = parts[0][i];
      if (parts.every(p => p[i] === seg)) common.push(seg); else break;
    }
    return common.length ? common.join('-') : null;
  }

  /** Flatten les attrs groupés d'un entry en un objet plat (sans "type"). */
  _flatAttrs(entry) {
    if (!entry || !entry.style) return {};
    const flat = {};
    for (const [k, v] of Object.entries(entry.style)) {
      if (typeof v === 'object' && v !== null) {
        for (const [sk, sv] of Object.entries(v)) flat[sk] = sv;
      } else if (k !== 'type') {
        flat[k] = v;
      }
    }
    return flat;
  }


  /**
   * Calcule l'intersection de plusieurs objets plats (propriétés identiques dans tous).
   */
  _intersectProps(flatMaps) {
    if (!flatMaps.length) return {};
    const [first, ...rest] = flatMaps;
    const result = {};
    for (const [k, v] of Object.entries(first)) {
      if (rest.every(m => m[k] === v)) result[k] = v;
    }
    return result;
  }

  /**
   * Transforme un objet plat de propriétés CSS (ex: { 'flex-direction': 'row' })
   * en déclarations CSS brutes pour le reverse mapper.
   * On doit "défaire" le reverse mapper (re-mapper layout→display:flex etc.).
   */
  _unFlatAttrs(flat) {
    const raw = {};
    for (const [k, v] of Object.entries(flat)) {
      // Les clés sont déjà en form "ycss" (layout, radius…), pas en CSS —
      // on doit repasser dans _reverseMap qui attend du CSS brut.
      // Donc on reconvertit les intentions en CSS d'abord.
      if (k === 'layout') {
        raw['display'] = 'flex';
        raw['flex-direction'] = v === 'row' ? 'row' : 'column';
      } else if (k === 'center') {
        if (v === true || v === 'true') {
          raw['align-items'] = 'center';
          raw['justify-content'] = 'center';
        }
      } else if (k === 'radius')     raw['border-radius'] = v;
      else if (k === 'shadow')        raw['box-shadow']    = v;
      else if (k === 'background')    raw['background']    = v;
      else if (k === 'padding')       raw['padding']       = v;
      else if (k === 'gap')           raw['gap']           = v;
      else if (k === 'cursor')        raw['cursor']        = v;
      else if (k === 'transition')    raw['transition']    = v;
      else if (k === 'width')         raw['width']         = v;
      else if (k === 'height')        raw['height']        = v;
      else if (k === 'size')          raw['font-size']     = v;
      else if (k === 'weight')        raw['font-weight']   = v;
      else if (k === 'color')         raw['color']         = v;
      else                            raw[k]               = v;
    }
    return raw;
  }

  /**
   * Retire d'un bloc attrs (groupé) les propriétés présentes dans intersection (plat).
   * Retourne un nouvel attrs sans les props communes.
   */
  _subtractAttrs(attrs, intersection) {
    const result = {};
    for (const [groupKey, groupVal] of Object.entries(attrs)) {
      if (typeof groupVal === 'object' && groupVal !== null && !Array.isArray(groupVal)) {
        // C'est un sous-groupe (layout, box, typo…)
        const filtered = {};
        for (const [k, v] of Object.entries(groupVal)) {
          if (!(k in intersection) || intersection[k] !== v) {
            filtered[k] = v;
          }
        }
        if (Object.keys(filtered).length) result[groupKey] = filtered;
      } else {
        // Scalaire au niveau attrs (type, etc.)
        if (!(groupKey in intersection) || intersection[groupKey] !== groupVal) {
          result[groupKey] = groupVal;
        }
      }
    }
    return result;
  }

  // ─── YAML serializer ────────────────────────────────────────────────────────



  _toStyleFile({ variables, breakpoints, mediaVariables, components, extends: extendsSection, skipped, combinatorsMap }) {
    const lines = [];

    // ── Variables ─────────────────────────────────────────────────────────────
    const hasBase       = Object.keys(variables).length > 0;
    const hasBreakpoints = Object.keys(breakpoints ?? {}).length > 0;
    const hasMedia      = Object.keys(mediaVariables ?? {}).length > 0;

    if (hasBase || hasBreakpoints || hasMedia) {
      lines.push('variables:');

      const TOKEN_PREFIX_GROUPS = [
        { prefix: 'color-',       label: 'Colors'        },
        { prefix: 'image-',       label: 'Images'        },
        { prefix: 'font-family-', label: 'Font families' },
        { prefix: 'font-size-',   label: 'Font sizes'    },
        { prefix: 'spacing-',     label: 'Spacing'       },
        { prefix: 'radius-',      label: 'Border radius' },
        { prefix: 'shadow-',      label: 'Shadows'       },
        { prefix: 'transition-',  label: 'Transitions'   },
      ];

      const _quoteVal = v => {
        const needsQuotes = /[:#,\[\]{}&*!|>'"%`]/.test(v) || v.trim() !== v;
        return needsQuotes ? `"${v.replace(/"/g, '\\"')}"` : v;
      };

      const _sep = label => {
        const dashes = '─'.repeat(Math.max(2, 52 - label.length));
        return `  # ─── ${label} ${dashes}`;
      };

      let firstGroup = true;
      for (const { prefix, label } of TOKEN_PREFIX_GROUPS) {
        const entries = Object.entries(variables).filter(([k]) => k.startsWith(prefix));
        if (!entries.length) continue;
        if (!firstGroup) lines.push('');
        firstGroup = false;
        lines.push(_sep(label));
        for (const [k, v] of entries) lines.push(`  ${k}: ${_quoteVal(v)}`);
      }

      // Breakpoint tokens  e.g.  breakpoint-mobile-768: "(max-width: 768px)"
      if (hasBreakpoints) {
        if (!firstGroup) lines.push('');
        firstGroup = false;
        lines.push(_sep('Breakpoints'));
        for (const [name, query] of Object.entries(breakpoints)) {
          lines.push(`  ${name}: ${_quoteVal(query)}`);
        }
      }

      lines.push('');
    }
    if (extendsSection != null) {
      lines.push('extends:');
      for (const [name, entry] of Object.entries(extendsSection)) {
        lines.push('');
        lines.push(`  ${name}:`);
        this._serializeComponentBlock(entry, lines, 4);
      }
      lines.push('');
    }
    lines.push('components:');
    for (const [name, entry] of Object.entries(components)) {
      lines.push('');
      lines.push(`  ${name}:`);
      this._serializeComponentBlock(entry, lines, 4);
    }
    // ── Combinators: selectors avec +, ~ ────────────────────────────────────
    if (combinatorsMap.length) {
      const catMap = this._buildSelectorCategoryMap();

      /**
       * Décompose un sélecteur CSS avec combinateur en arborescence :
       *   ".a .b .c + .d:after"
       *   → { parts: ['.a','.b','.c'], combinator: '+', targetSeg: '.d', pseudo: 'after', pseudoCategory: 'pseudo-elements' }
       */
      const _decompose = (sel, combinator) => {
        // Trouver la position du combinateur (hors attributs [])
        let splitAt = -1;
        for (let i = 0; i < sel.length; i++) {
          if (sel[i] === combinator) {
            let depth = 0;
            for (let k = 0; k < i; k++) { if (sel[k]==='[') depth++; else if (sel[k]===']') depth--; }
            if (depth > 0) continue;
            splitAt = i;
            break;
          }
        }
        if (splitAt === -1) return null;

        const before  = sel.slice(0, splitAt).trim();
        const after   = sel.slice(splitAt + 1).trim();
        const parts   = before.split(/\s+/).filter(Boolean);

        // Si le segment après le combinateur contient lui-même un autre combinateur
        // (ex: "+ .message + label"), c'est trop complexe → on rejette
        const COMBINATOR_RE = /(?:^|\s)[+~>](?:\s|$)/;
        if (COMBINATOR_RE.test(after)) return null;

        // Décomposer le segment cible : ".foo:hover", ".foo::after", ".foo:nth-child(2)"
        // → { targetName, pseudo, pseudoCategory }
        let targetSeg = after;
        let pseudo = null, pseudoCategory = null;

        // ::pseudo-element en fin
        const pemMatch = targetSeg.match(/::([a-z-]+)$/i);
        if (pemMatch) {
          pseudo = pemMatch[1];
          pseudoCategory = catMap.get(pseudo) ?? 'pseudo-elements';
          targetSeg = targetSeg.slice(0, targetSeg.lastIndexOf('::' + pseudo)).trim();
        }

        // :pseudo-class en fin (simple ou avec args)
        if (!pseudo) {
          const pcmMatch = targetSeg.match(/:([a-z-]+)(?:\([^)]*\))?$/i);
          if (pcmMatch) {
            const name = pcmMatch[1];
            const full = pcmMatch[0];
            const cat  = catMap.get(name);
            if (cat && cat !== 'combinators') {
              pseudo = name;
              pseudoCategory = cat;
              targetSeg = targetSeg.slice(0, targetSeg.lastIndexOf(full)).trim();
            }
          }
        }

        // Si after contient plusieurs segments séparés par des espaces
        // (ex: "div select"), décomposer en tailParts :
        //   targetSeg = premier segment (cible directe du combinateur)
        //   tailParts = segments suivants (descendants de la cible)
        // Le pseudo n'est extrait que du dernier segment.
        const afterParts = targetSeg.split(/\s+/).filter(Boolean);
        // Le pseudo a déjà été extrait du dernier segment — le reconstruire sans pseudo
        // pour identifier la vraie cible directe du combinateur.
        // afterParts[0] = cible directe, afterParts[1..] = descendants intermédiaires
        // Note: targetSeg a déjà le pseudo retiré, donc afterParts est propre.
        const tailDescendants = afterParts.slice(1).map(s =>
          s.startsWith('.') || s.startsWith('#') ? s.slice(1) : s
        );

        // Nom de clé YAML pour la cible directe : strip . ou #
        let targetName = afterParts[0];
        if (targetName.startsWith('.')) targetName = targetName.slice(1);
        else if (targetName.startsWith('#')) targetName = targetName.slice(1);

        return { parts, combinator, targetName, tailDescendants, pseudo, pseudoCategory };
      };

      /**
       * Normalise un segment CSS en nom de clé YAML.
       * ".foo" → "foo", "#bar" → "bar", "tag.foo" → "tag.foo" (gardé)
       */
      const _segKey = (seg) => {
        let name = seg;
        if (name.startsWith('.')) name = name.slice(1);
        else if (name.startsWith('#')) name = name.slice(1);
        const needsQuote = /[:.#\[\]*&!|>'"@{} ]/.test(name);
        return needsQuote ? `"${name.replace(/"/g, '\\"')}"` : name;
      };

      /**
       * Structure de l'arbre :
       *   Map<segKey, {
       *     children: Map<...>,
       *     combinators: Map<combinatorChar, Map<targetName, {
       *       byPseudo: Map<pseudoKey, grouped>,  // pseudo-elements / states / …
       *       base: grouped | null               // sans pseudo
       *     }>>
       *   }>
       */
      const _insert = (tree, parts, combinator, targetName, tailDescendants, pseudo, pseudoCategory, grouped) => {
        // Naviguer jusqu'au nœud feuille (les parts AVANT le combinateur)
        let node = tree;
        for (const part of parts) {
          const key = part;
          if (!node.has(key)) node.set(key, { children: new Map(), combinators: new Map() });
          node = node.get(key).children;
        }
        // Récupérer le nœud feuille (dernier part)
        // En fait node est déjà le children du dernier ancêtre ; remonter d'un cran
        // On navigue différemment : construire le chemin proprement
        let cur = tree;
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i];
          if (!cur.has(p)) cur.set(p, { children: new Map(), combinators: new Map() });
          cur = cur.get(p).children;
        }
        const leafKey = parts[parts.length - 1];
        if (!cur.has(leafKey)) cur.set(leafKey, { children: new Map(), combinators: new Map() });
        const leaf = cur.get(leafKey);

        // Attacher l'entrée combinateur au nœud feuille
        if (!leaf.combinators.has(combinator)) leaf.combinators.set(combinator, new Map());
        const targetsMap = leaf.combinators.get(combinator);
        if (!targetsMap.has(targetName)) targetsMap.set(targetName, { byPseudo: new Map(), base: null, descendants: new Map() });
        const targetNode = targetsMap.get(targetName);

        // Si des descendants intermédiaires existent (ex: "div select" → div est la cible,
        // select est un descendant), les placer dans targetNode.descendants
        if (tailDescendants && tailDescendants.length > 0) {
          // Naviguer/créer la chaîne de descendants
          let descNode = targetNode.descendants;
          for (let i = 0; i < tailDescendants.length - 1; i++) {
            const d = tailDescendants[i];
            if (!descNode.has(d)) descNode.set(d, { byPseudo: new Map(), base: null, descendants: new Map() });
            descNode = descNode.get(d).descendants;
          }
          const lastDesc = tailDescendants[tailDescendants.length - 1];
          if (!descNode.has(lastDesc)) descNode.set(lastDesc, { byPseudo: new Map(), base: null, descendants: new Map() });
          const leafDescNode = descNode.get(lastDesc);
          // Attacher pseudo/base au nœud descendant feuille
          if (pseudo) {
            const pseudoKey = `${pseudoCategory}::${pseudo}`;
            leafDescNode.byPseudo.set(pseudoKey, { category: pseudoCategory, pseudo, grouped });
          } else {
            leafDescNode.base = grouped;
          }
          return;
        }

        if (pseudo) {
          // Clé = "pseudoCategory.pseudo" pour regrouper par catégorie
          const pseudoKey = `${pseudoCategory}::${pseudo}`;
          if (!targetNode.byPseudo.has(pseudoKey)) {
            targetNode.byPseudo.set(pseudoKey, { category: pseudoCategory, pseudo, grouped });
          } else {
            // Merger les grouped si plusieurs déclarations pour le même pseudo
            const existing = targetNode.byPseudo.get(pseudoKey);
            for (const [gk, gv] of Object.entries(grouped)) {
              if (typeof gv === 'object' && gv !== null) {
                existing.grouped[gk] = { ...(existing.grouped[gk] ?? {}), ...gv };
              } else {
                existing.grouped[gk] = gv;
              }
            }
          }
        } else {
          targetNode.base = grouped;
        }
      };

      // Construire l'arbre
      const tree = new Map();
      for (const { sel, combinator, decls } of combinatorsMap) {
        const dec = _decompose(sel, combinator);
        if (!dec) continue;
        if (!dec.parts.length) continue;
        const { intents, leftovers } = this._reverseMap({ ...decls });
        const grouped = this._groupProps({ ...intents, ...leftovers });
        _insert(tree, dec.parts, dec.combinator, dec.targetName, dec.tailDescendants, dec.pseudo, dec.pseudoCategory, grouped);
      }

      /**
       * Sérialise récursivement l'arbre dans les lignes YAML.
       *
       * Structure émise pour chaque nœud feuille avec combinateurs :
       *
       *   leafKey:
       *     - combinators: "+"
       *       targetName:
       *         pseudo-elements:
       *           after:
       *             attrs: ...
       *         states:
       *           hover:
       *             attrs: ...
       *         attrs: ...   ← si des déclarations sans pseudo
       *     - combinators: "~"
       *       ...
       */
      const _serializeCombinatorEntries = (combinatorsMap, lines, indent) => {
        const pad = ' '.repeat(indent);
        for (const [combinatorChar, targetsMap] of combinatorsMap) {
          // Émettre un item de liste YAML par combinateur
          lines.push(`${pad}- combinators: "${combinatorChar}"`);
          const innerPad = ' '.repeat(indent + 2);
          for (const [targetName, { byPseudo, base, descendants }] of targetsMap) {
            const needsQuote = /[:.#\[\]*&!|>'"@{} ]/.test(targetName);
            const tk = needsQuote ? `"${targetName.replace(/"/g, '\\"')}"` : targetName;
            lines.push(`${innerPad}${tk}:`);
            const attrsIndent = indent + 4;

            // Base attrs (sans pseudo)
            if (base && Object.keys(base).length) {
              lines.push(`${' '.repeat(attrsIndent)}style:`);
              this._serializeStyleInline(base, lines, attrsIndent + 2);
            }

            // Regrouper les pseudos par catégorie
            // Map<category, Map<pseudoName, grouped>>
            const byCategory = new Map();
            for (const { category, pseudo, grouped } of byPseudo.values()) {
              if (!byCategory.has(category)) byCategory.set(category, new Map());
              byCategory.get(category).set(pseudo, grouped);
            }

            for (const [category, pseudosMap] of byCategory) {
              lines.push(`${' '.repeat(attrsIndent)}- ${category}:`);
              for (const [pseudoName, grouped] of pseudosMap) {
                lines.push(`${' '.repeat(attrsIndent + 4)}${pseudoName}:`);
                if (Object.keys(grouped).length) {
                  lines.push(`${' '.repeat(attrsIndent + 6)}style:`);
                  this._serializeStyleInline(grouped, lines, attrsIndent + 8);
                }
              }
            }

            // Descendants intermédiaires (ex: "div select" → select imbriqué sous div)
            if (descendants && descendants.size) {
              _serializeDescendants(descendants, lines, attrsIndent);
            }
          }
        }
      };

      /**
       * Sérialise récursivement les nœuds descendants d'une cible combinateur.
       * Chaque nœud est un Map<name, { byPseudo, base, descendants }>.
       */
      const _serializeDescendants = (descMap, lines, indent) => {
        const pad = ' '.repeat(indent);
        for (const [name, { byPseudo, base, descendants: subDesc }] of descMap) {
          const needsQuote = /[:.#[\]*&!|>'"@{} ]/.test(name);
          const key = needsQuote ? `"${name.replace(/"/g, '\"')}"` : name;
          lines.push(`${pad}${key}:`);
          const childIndent = indent + 2;

          if (base && Object.keys(base).length) {
            lines.push(`${' '.repeat(childIndent)}style:`);
            this._serializeStyleInline(base, lines, childIndent + 2);
          }

          const byCategory = new Map();
          for (const { category, pseudo, grouped } of byPseudo.values()) {
            if (!byCategory.has(category)) byCategory.set(category, new Map());
            byCategory.get(category).set(pseudo, grouped);
          }
          for (const [category, pseudosMap] of byCategory) {
            lines.push(`${' '.repeat(childIndent)}- ${category}:`);
            for (const [pseudoName, grouped] of pseudosMap) {
              lines.push(`${' '.repeat(childIndent + 4)}${pseudoName}:`);
              if (Object.keys(grouped).length) {
                lines.push(`${' '.repeat(childIndent + 6)}style:`);
                this._serializeStyleInline(grouped, lines, childIndent + 8);
              }
            }
          }

          if (subDesc && subDesc.size) {
            _serializeDescendants(subDesc, lines, childIndent);
          }
        }
      };

      const _serialize = (node, lines, indent) => {
        const pad = ' '.repeat(indent);
        for (const [seg, { children, combinators }] of node) {
          const key = _segKey(seg);
          lines.push(`${pad}${key}:`);
          // Combinateurs attachés à ce nœud (structure liste YAML)
          if (combinators.size) {
            _serializeCombinatorEntries(combinators, lines, indent + 2);
          }
          // Enfants récursifs
          if (children.size) _serialize(children, lines, indent + 2);
        }
      };

      // ── Fusion des clés racines dupliquées ──────────────────────────────────
      // Si une clé racine du tree existe déjà dans components, on injecte ses
      // enfants/combinateurs directement dans le bloc existant (évite les doublons).
      // Les clés nouvelles vont dans la section # ── Combinator selectors.
      const existingKeys  = new Set(Object.keys(components));
      const mergedKeys    = [];  // clés racines fusionnées dans components
      const newKeys       = [];  // clés racines réellement nouvelles

      const _stripPrefix = s => (s.startsWith('.') || s.startsWith('#')) ? s.slice(1) : s;

      for (const [seg] of tree) {
        const normalizedSeg = _stripPrefix(seg);
        (existingKeys.has(normalizedSeg) || existingKeys.has(seg) ? mergedKeys : newKeys).push(seg);
      }

      // Injecter les clés fusionnées : trouver leur bloc dans lines et y ajouter
      // les enfants/combinateurs issus du tree
      if (mergedKeys.length) {
        for (const seg of mergedKeys) {
          const { children, combinators } = tree.get(seg);
          // Utiliser le nom normalisé (sans . ou #) pour retrouver le bloc dans lines[]
          const normalizedSeg = _stripPrefix(seg);
          const rootMarker    = `  ${normalizedSeg}:`;
          const startIdx      = lines.lastIndexOf(rootMarker);
          if (startIdx === -1) continue; // sécurité

          // Déterminer l'indice de fin du bloc : prochaine ligne de niveau 2
          // (commence par exactement deux espaces + non-espace, ou fin)
          let insertAt = lines.length;
          for (let i = startIdx + 1; i < lines.length; i++) {
            const l = lines[i];
            if (l.length > 0 && /^  [^ ]/.test(l)) { insertAt = i; break; }
          }

          // Sérialiser uniquement les enfants/combinateurs de ce nœud racine
          const extraLines = [];
          if (combinators.size) {
            _serializeCombinatorEntries(combinators, extraLines, 4);
          }
          if (children.size) _serialize(children, extraLines, 4);

          // Insérer avant insertAt
          lines.splice(insertAt, 0, ...extraLines);
        }
      }

      // Émettre les clés vraiment nouvelles dans la section dédiée
      if (newKeys.length) {
        lines.push('');
        lines.push('  # ── Combinator selectors (' + newKeys.length + ') ──────────────────────────────');
        for (const seg of newKeys) {
          const { children, combinators } = tree.get(seg);
          const key = _segKey(seg);
          lines.push(`  ${key}:`);
          if (combinators.size) _serializeCombinatorEntries(combinators, lines, 4);
          if (children.size) _serialize(children, lines, 4);
        }
      }
    }

    if (skipped.length) {
      lines.push('');
      lines.push('# ─── Complex selectors (not converted) ─────────────────────────────────────');
      for (const { sel, decls } of skipped) {
        lines.push(`# ${sel}`);
        for (const [p, v] of Object.entries(decls)) lines.push(`#   ${p}: ${v}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Sérialise un bloc composant ou enfant.
   *
   * Structure attendue :
   *   {
   *     type?:   'id' | 'class'
   *     attrs?:  { layout?: {}, box?: {}, … },
   *     states?: { hover: { style: {} }, … },
   *     media?:  { "(max-width:768px)": { attrs?: {}, states?: {} } },
   *     <child>: { attrs?: {}, states?: {}, … },   ← enfants
   *   }
   *
   * Ordre de sortie : type → extends → attrs → states → media → enfants
   */
  /**
   * Sérialise un objet de props groupées (sortie de _groupProps) en lignes YAML
   * à l'indentation donnée (en espaces).
   * Exemple avec indent=12 :
   *   "            box:"
   *   "              padding: 8px"
   */
  _serializeStyleInline(grouped, lines, indent) {
    const pad  = ' '.repeat(indent);
    const pad2 = ' '.repeat(indent + 2);
    for (const [group, props] of Object.entries(grouped)) {
      if (props && typeof props === 'object' && !Array.isArray(props)) {
        const entries = Object.entries(props);
        if (!entries.length) continue;
        lines.push(`${pad}${group}:`);
        for (const [k, v] of entries) {
          const needsQuotes = typeof v === 'string' && /[:#,\[\]{}*&!|>'"%@`]/.test(v);
          lines.push(`${pad2}${k}: ${needsQuotes ? `"${v.replace(/"/g, '\\"')}"` : v}`);
        }
      } else {
        const needsQuotes = typeof props === 'string' && /[:#,\[\]{}*&!|>'"%@`]/.test(props);
        lines.push(`${pad}${group}: ${needsQuotes ? `"${String(props).replace(/"/g, '\\"')}"` : props}`);
      }
    }
  }

  _serializeComponentBlock(entry, lines, indent) {
    const pad = ' '.repeat(indent);

    // 0. type: (id ou class — avant tout le reste)
    if (entry.type != null) {
      lines.push(`${pad}type: ${entry.type}`);
    }

    // 1. extends: (référence à un composant partagé, ex: @tutu)
    if (entry.extends != null) {
      const ref = String(entry.extends);
      lines.push(`${pad}extends: ${ref}`);
    }

    // 2. attrs:
    if (entry.style && Object.keys(entry.style).length) {
      lines.push(`${pad}style:`);
      this._serializeStyleBlock(entry.style, lines, indent + 2);
    }

    // 2. - {category}: (liste YAML, sans wrapper selectors:)
    if (entry.states && Object.keys(entry.states).length) {
      const byCategory = this._groupStatesByCategory(entry.states);
      for (const [category, statesMap] of byCategory) {
        lines.push(`${pad}- ${category}:`);
        for (const [state, stateEntry] of Object.entries(statesMap)) {
          lines.push(`${pad}    ${state}:`);
          this._serializeComponentBlock(stateEntry, lines, indent + 6);
        }
      }
    }

    // 3. media:
    if (entry.media && Object.keys(entry.media).length) {
      lines.push(`${pad}media:`);
      for (const [query, mqEntry] of Object.entries(entry.media)) {
        const nqk = /[:#,\[\]{}&*!|>'"%@`\(\)]/.test(query) || query.trim() !== query;
        lines.push(nqk ? `${pad}  "${query}":` : `${pad}  ${query}:`);
        this._serializeComponentBlock(mqEntry, lines, indent + 4);
      }
    }

    // 4. Enfants (tout ce qui n'est pas type / extends / attrs / states / media)
    for (const [key, value] of Object.entries(entry)) {
      if (STRUCTURAL_KEYS.has(key) || key === 'style' || key === 'type') continue;
      if (typeof value !== 'object' || value === null) continue;
      lines.push(`${pad}${key}:`);
      this._serializeComponentBlock(value, lines, indent + 2);
    }
  }

  /**
   * Construit un Map<normalizedName, categoryKey> à partir de selectors.yaml.
   * Ex : "before" → "pseudo-elements", "hover" → "states", "root" → "miscellaneous"
   * Résultat mis en cache sur l'instance.
   */
  _buildSelectorCategoryMap() {
    if (this._selectorCategoryMap) return this._selectorCategoryMap;

    const yaml = require('js-yaml');
    const _collectCandidates = (startDir) => {
      const found = [];
      let dir = startDir;
      while (true) {
        found.push(path.join(dir, 'selectors.yaml'));
        if (fs.existsSync(path.join(dir, 'package.json'))) break;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return found;
    };
    const candidates = [
      path.join(process.cwd(), 'selectors.yaml'),
      ..._collectCandidates(__dirname),
    ];

    const map = new Map();
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          const doc = yaml.load(fs.readFileSync(candidate, 'utf8')) ?? {};
          for (const [category, entries] of Object.entries(doc.selectors ?? {})) {
            for (const entry of (entries ?? [])) {
              // Normalise "::before" → "before", ":hover" → "hover", "::slotted(*)" → "slotted"
              // Combinators (>, +, ~) are kept as-is (no leading colons to strip)
              const raw  = String(entry).trim();
              const name = raw.startsWith(':')
                ? raw.replace(/^::?/, '').replace(/\(.*\)$/, '').trim()
                : raw;
              if (name && !map.has(name)) map.set(name, category);
            }
          }
          this._selectorCategoryMap = map;
          return map;
        } catch (_) { /* fichier corrompu, on continue */ }
      }
    }

    // Fallback : pas de selectors.yaml → catégories par défaut
    const FALLBACK = {
      'pseudo-elements': [
        'before', 'after', 'first-line', 'first-letter',
        'selection', 'placeholder', 'marker', 'backdrop',
        'spelling-error', 'grammar-error', 'slotted',
      ],
      'states': [
        'hover', 'focus', 'active', 'checked', 'disabled',
        'focus-within', 'focus-visible', 'first-child', 'last-child',
        'first-of-type', 'last-of-type', 'nth-child', 'nth-of-type',
        'not', 'empty', 'visited', 'link', 'target',
      ],
      'miscellaneous': ['root', 'host', 'host-context'],
    };
    for (const [cat, names] of Object.entries(FALLBACK))
      for (const name of names) map.set(name, cat);
    this._selectorCategoryMap = map;
    return map;
  }

  /**
   * Groupe les states d'un entry par leur catégorie selectors.yaml.
   * Retourne un Map<category, { [state]: stateEntry }> dans l'ordre de déclaration.
   * Les states inconnus tombent dans la catégorie de fallback "selectors".
   */
  _groupStatesByCategory(states) {
    const catMap = this._buildSelectorCategoryMap();
    const grouped = new Map();

    for (const [state, stateEntry] of Object.entries(states)) {
      const category = catMap.get(state) ?? 'states';
      if (!grouped.has(category)) grouped.set(category, {});
      grouped.get(category)[state] = stateEntry;
    }

    return grouped;
  }

  /**
   * Sérialise le contenu d'un bloc attrs: (groupes + scalaires).
   * Les groupes (layout, box, typo…) sont émis comme sous-objets.
   */
  _serializeStyleBlock(attrs, lines, indent) {
    this._serializeBlock(attrs, lines, indent);
  }

  /**
   * Sérialiseur générique clé/valeur avec gestion des guillemets.
   */
  _serializeBlock(obj, lines, indent) {
    const pad = ' '.repeat(indent);
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'boolean') {
        lines.push(`${pad}${k}: ${v}`);
      } else if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) {
        const nqk = /[:#,\[\]{}&*!|>'"%`\(\)]/.test(k) || k.trim() !== k;
        lines.push(nqk ? `${pad}"${k}":` : `${pad}${k}:`);
        this._serializeBlock(v, lines, indent + 2);
      } else if (typeof v === 'string') {
        const nqv = /[:#,\[\]{}&*!|>'"%`]/.test(v) || v.trim() !== v;
        lines.push(nqv
          ? `${pad}${k}: "${v.replace(/"/g, '\\"')}"`
          : `${pad}${k}: ${v}`
        );
      } else {
        lines.push(`${pad}${k}: ${v}`);
      }
    }
  }
}

module.exports = CSSConverter;
