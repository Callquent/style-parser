'use strict';

const fs  = require('fs');
const path = require('path');
const css  = require('css');

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
    if (sel.includes(',')) return { type: 'multi', parts: sel.split(',').map(s => s.trim()) };
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
        if (p.type === 'multi') {
          // Recurse: treat each part as an individual selector rule
          for (const part of p.parts) {
            const sub = this._parseSelector(part);
            if (sub.type === 'complex') { skipped.push({ sel: part, decls: rd }); continue; }
            const cs = gc(sub.base);
            if (mq) {
              cs.media[mq] ??= { base: {}, states: {} };
              if (sub.type === 'base') Object.assign(cs.media[mq].base, rd);
              else if (sub.type === 'state') { cs.media[mq].states[sub.state] ??= {}; Object.assign(cs.media[mq].states[sub.state], rd); }
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
        if (p.type === 'complex') { skipped.push({ sel: rs, decls: rd }); continue; }
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

    const { components: deduped, extends: sharedComps } = this._deduplicateComponents(sc);
    return { variables: rt, extends: sharedComps, components: deduped, skipped };
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
      sharedEntry.attrs = this._groupProps({ ...intents, ...leftovers });
    }
    for (const [childName, childEntry] of Object.entries(childInter)) {
      sharedEntry[childName] = childEntry;
    }
    extendsSection[sharedName] = sharedEntry;

    // Mettre à jour chaque membre
    for (const memberName of members) {
      const entry = { ...updatedComponents[memberName] };
      if (attrScore > 0) entry.attrs = this._subtractAttrs(entry.attrs ?? {}, attrInter);
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
      if (['attrs', 'states', 'media', 'extends'].includes(key)) continue;
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
    if (!entry || !entry.attrs) return {};
    const flat = {};
    for (const [k, v] of Object.entries(entry.attrs)) {
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

  _toStyleFile({ variables, components, extends: extendsSection, skipped }) {
    const lines = [];
    if (Object.keys(variables).length) {
      lines.push('variables:');
      for (const [k, v] of Object.entries(variables)) lines.push(`  ${k}: "${v}"`);
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
