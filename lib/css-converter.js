'use strict';

const fs  = require('fs');
const path = require('path');
const css = require('css');

const GROUPS = {
  layout:       new Set(['layout','center','display']),
  box:          new Set(['padding','gap','width','height','radius','shadow','margin-top','margin-bottom']),
  typo:         new Set(['size','weight','font-family','line-height','text-transform','text-align','text-decoration','white-space','text-overflow']),
  appearance:   new Set(['background','color']),
  interactions: new Set(['cursor','transition','transform','opacity','overflow','visibility']),
};

// Clés qui ne vont jamais dans attrs:
const STRUCTURAL_KEYS = new Set(['extends', 'states', 'media']);
// Clé type: reste dans attrs:
const ATTRS_SCALAR_KEYS = new Set(['type']);

class CSSConverter {

  convertFile(filePath) {
    return this.convertString(fs.readFileSync(path.resolve(filePath), 'utf8'));
  }

  convertString(cssText) {
    return this._toStyleFile(this._convert(cssText));
  }

  // ─── Group bucketing ────────────────────────────────────────────────────────

  /**
   * Range les propriétés plates dans leurs groupes (layout, box, typo…).
   * Retourne { type?, layout?: {}, box?: {}, … }
   */
  _groupProps(props) {
    const top     = {};
    const buckets = { layout: {}, box: {}, typo: {}, appearance: {}, interactions: {} };
    const rest    = {};

    for (const [k, v] of Object.entries(props)) {
      if (ATTRS_SCALAR_KEYS.has(k)) { top[k] = v; continue; }
      let placed = false;
      for (const [g, ks] of Object.entries(GROUPS)) {
        if (ks.has(k)) { buckets[g][k] = v; placed = true; break; }
      }
      if (!placed) rest[k] = v;
    }

    const grouped = {};
    for (const [g, p] of Object.entries(buckets)) {
      if (Object.keys(p).length) grouped[g] = p;
    }
    return { ...top, ...grouped, ...rest };
  }

  // ─── Reverse property mapper ────────────────────────────────────────────────

  _reverseMap(decls) {
    const d = { ...decls }, out = {};
    if (d['display'] === 'flex' || d['display'] === 'inline-flex') {
      if (d['display'] === 'inline-flex') out['display'] = 'inline-flex';
      out['layout'] = (d['flex-direction'] ?? 'row') === 'column' ? 'column' : 'row';
      delete d['display']; delete d['flex-direction'];
      if (d['align-items'] === 'center' && d['justify-content'] === 'center') {
        out['center'] = true;
        delete d['align-items']; delete d['justify-content'];
      }
    }
    if (d['padding'])          { out['padding']       = d['padding'];          delete d['padding']; }
    if (d['gap'])              { out['gap']           = d['gap'];              delete d['gap']; }
    if (d['background'])       { out['background']    = d['background'];       delete d['background']; }
    if (d['background-color']) { out['background']    = d['background-color']; delete d['background-color']; }
    if (d['border-radius'])    { out['radius']        = d['border-radius'];    delete d['border-radius']; }
    if (d['box-shadow'])       { out['shadow']        = d['box-shadow'];       delete d['box-shadow']; }
    if (d['cursor'])           { out['cursor']        = d['cursor'];           delete d['cursor']; }
    if (d['transition'])       { out['transition']    = d['transition'];       delete d['transition']; }
    if (d['transform'])        { out['transform']     = d['transform'];        delete d['transform']; }
    if (d['width'])            { out['width']         = d['width'];            delete d['width']; }
    if (d['height'])           { out['height']        = d['height'];           delete d['height']; }
    if (d['font-size'])        { out['size']          = d['font-size'];        delete d['font-size']; }
    if (d['font-weight'])      { out['weight']        = this._wl(d['font-weight']); delete d['font-weight']; }
    if (d['color'])            { out['color']         = d['color'];            delete d['color']; }
    if (d['margin-top'])       { out['margin-top']    = d['margin-top'];       delete d['margin-top']; }
    if (d['margin-bottom'])    { out['margin-bottom'] = d['margin-bottom'];    delete d['margin-bottom']; }
    return { intents: out, leftovers: d };
  }

  _wl(v) {
    const map = { '700':'bold','600':'semibold','400':'normal','300':'light',
                  bold:'bold',semibold:'semibold',normal:'normal',light:'light' };
    return map[v] ?? v;
  }

  // ─── Selector parser ────────────────────────────────────────────────────────

  _normalizePart(part) {
    if (/[\[\(]/.test(part)) return null;
    part = part.replace(/::[\w-]+$/, '').trim();
    if (!part) return null;
    const id = part.match(/#([\w-]+)/);  if (id)  return { name: id[1],  selectorType: 'id' };
    const cl = part.match(/\.([\w-]+)/); if (cl)  return { name: cl[1],  selectorType: 'class' };
    if (/^[a-z][a-z0-9-]*$/.test(part)) return { name: part, selectorType: 'tag' };
    return null;
  }

  _toBase(n) { return (n.selectorType === 'id' ? '#' : '.') + n.name; }

  _parseSelector(rawSel) {
    let sel = rawSel.trim();
    if (sel.includes(',')) return { type: 'complex', raw: rawSel };
    sel = sel.replace(/\s*[>~+]\s*/g, ' ').trim();
    let state = null;
    const pm = sel.match(/:([\w-]+)$/);
    if (pm) {
      const c = pm[1], b = sel.slice(0, sel.lastIndexOf(':' + c));
      if (!b.endsWith('(')) { state = c; sel = b.trim(); }
    }
    const rp = sel.split(/\s+/).filter(Boolean);
    if (!rp.length) return { type: 'complex', raw: rawSel };
    const parts = rp.map(p => this._normalizePart(p));
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
    const CR = /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^hsl/, counts = new Map();
    const scan = o => {
      if (!o || typeof o !== 'object') return;
      for (const v of Object.values(o)) {
        if (typeof v === 'string' && CR.test(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
        else scan(v);
      }
    };
    for (const c of Object.values(components)) scan(c);
    const t = {}; let i = 1;
    for (const [v, n] of counts) if (n >= 2) t[`color-${i++}`] = v;
    return t;
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
    const components = {}, skipped = [];

    const gc = k => {
      if (!components[k]) components[k] = { base: {}, states: {}, children: {}, childStates: {}, media: {} };
      return components[k];
    };

    const pr = (rule, mq = null) => {
      const rd = this._declsToMap(rule.declarations);
      if (!Object.keys(rd).length) return;
      for (const rs of (rule.selectors ?? [])) {
        const p = this._parseSelector(rs);
        if (p.type === 'complex') { skipped.push({ sel: p.raw, decls: rd }); continue; }
        const c = gc(p.base);
        if (mq) {
          c.media[mq] ??= { base: {}, states: {} };
          if (p.type === 'base') Object.assign(c.media[mq].base, rd);
          else if (p.type === 'state') { c.media[mq].states[p.state] ??= {}; Object.assign(c.media[mq].states[p.state], rd); }
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

    const rt = this._extractTokens(components);
    const tbv = new Map(Object.entries(rt).map(([k, v]) => [v, k]));
    const sc = {};

    for (const [sel, comp] of Object.entries(components)) {
      const isId = sel.startsWith('#'), name = sel.replace(/^[.#]/, '');
      const { intents: bi, leftovers: br } = this._reverseMap({ ...comp.base });

      // Propriétés de base → attrs:
      const attrsProps = this._groupProps({ type: isId ? 'id' : 'class', ...bi, ...br });
      const entry = { attrs: attrsProps };

      // states: → sous states: (dans attrs niveau composant, pas dans attrs)
      if (Object.keys(comp.states).length) {
        entry.states = {};
        for (const [s, d] of Object.entries(comp.states)) {
          const { intents: i, leftovers: l } = this._reverseMap({ ...d });
          entry.states[s] = { attrs: this._groupProps({ ...i, ...l }) };
        }
      }

      // Enfants → clés au même niveau qu'attrs
      const ac = new Set([...Object.keys(comp.children), ...Object.keys(comp.childStates)]);
      for (const child of ac) {
        const { intents: i, leftovers: l } = this._reverseMap({ ...(comp.children[child] ?? {}) });
        const childEntry = { attrs: this._groupProps({ ...i, ...l }) };
        const cs = comp.childStates[child] ?? {};
        if (Object.keys(cs).length) {
          childEntry.states = {};
          for (const [s, d] of Object.entries(cs)) {
            const { intents: si, leftovers: sl } = this._reverseMap({ ...d });
            childEntry.states[s] = { attrs: this._groupProps({ ...si, ...sl }) };
          }
        }
        entry[child] = childEntry;
      }

      // media: → sous media:
      if (Object.keys(comp.media).length) {
        entry.media = {};
        for (const [q, mb] of Object.entries(comp.media)) {
          const mqEntry = {};
          if (Object.keys(mb.base).length) {
            const { intents: i, leftovers: l } = this._reverseMap({ ...mb.base });
            mqEntry.attrs = this._groupProps({ ...i, ...l });
          }
          if (Object.keys(mb.states).length) {
            mqEntry.states = {};
            for (const [s, d] of Object.entries(mb.states)) {
              const { intents: i, leftovers: l } = this._reverseMap({ ...d });
              mqEntry.states[s] = { attrs: this._groupProps({ ...i, ...l }) };
            }
          }
          entry.media[q] = mqEntry;
        }
      }

      sc[name] = this._subTokens(entry, tbv);
    }

    return { tokens: rt, components: sc, skipped };
  }

  // ─── YAML serializer ────────────────────────────────────────────────────────

  _toStyleFile({ tokens, components, extends: extendsSection, skipped }) {
    const lines = [];
    if (Object.keys(tokens).length) {
      lines.push('tokens:');
      for (const [k, v] of Object.entries(tokens)) lines.push(`  ${k}: "${v}"`);
      lines.push('');
    }
    if (extendsSection && Object.keys(extendsSection).length) {
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
   *     attrs?:  { type?, layout?: {}, box?: {}, … },
   *     states?: { hover: { attrs: {} }, … },
   *     media?:  { "(max-width:768px)": { attrs?: {}, states?: {} } },
   *     <child>: { attrs?: {}, states?: {}, … },   ← enfants
   *   }
   *
   * Ordre de sortie : attrs → states → media → enfants
   */
  _serializeComponentBlock(entry, lines, indent) {
    const pad = ' '.repeat(indent);

    // 0. extends: (référence à un composant partagé, ex: @tutu)
    if (entry.extends != null) {
      const ref = String(entry.extends);
      lines.push(`${pad}extends: ${ref}`);
    }

    // 1. attrs:
    if (entry.attrs && Object.keys(entry.attrs).length) {
      lines.push(`${pad}attrs:`);
      this._serializeAttrsBlock(entry.attrs, lines, indent + 2);
    }

    // 2. states:
    if (entry.states && Object.keys(entry.states).length) {
      lines.push(`${pad}states:`);
      for (const [state, stateEntry] of Object.entries(entry.states)) {
        lines.push(`${pad}  ${state}:`);
        this._serializeComponentBlock(stateEntry, lines, indent + 4);
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

    // 4. Enfants (tout ce qui n'est pas attrs / states / media)
    for (const [key, value] of Object.entries(entry)) {
      if (STRUCTURAL_KEYS.has(key) || key === 'attrs') continue;
      if (typeof value !== 'object' || value === null) continue;
      lines.push(`${pad}${key}:`);
      this._serializeComponentBlock(value, lines, indent + 2);
    }
  }

  /**
   * Sérialise le contenu d'un bloc attrs: (groupes + scalaires).
   * Les groupes (layout, box, typo…) sont émis comme sous-objets.
   */
  _serializeAttrsBlock(attrs, lines, indent) {
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
