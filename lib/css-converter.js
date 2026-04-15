'use strict';

const fs  = require('fs');
const path = require('path');
const css = require('css');

/**
 * CSSConverter
 *
 * Converts plain CSS into a .style YAML document compatible with style-parser.
 *
 * Usage:
 *   const { CSSConverter } = require('style-parser');
 *   const styleYaml = new CSSConverter().convertFile('./input.css');
 *   const styleYaml = new CSSConverter().convertString(cssString);
 *
 * Selector patterns handled:
 *   .foo / #foo                  → component (type: class / type: id)
 *   .foo:hover                   → states block
 *   .foo .bar                    → children block
 *   .foo .bar:hover              → children states block
 *   tag.class / tag#id           → strip tag, use class/id name
 *   tag (html element)           → component keyed by tag name
 *   .a > .b / .a ~ .b / .a + .b → combinator treated as space
 *   .a .b .c … (3+ levels)      → flattened: first part + last part
 *   @media …                     → media block
 *
 * Selectors that cannot be converted (attribute selectors, :not(), etc.)
 * are preserved as YAML comments at the bottom of the output.
 */
class CSSConverter {

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Convert a CSS file to a .style YAML string.
   * @param {string} filePath  Path to the .css file
   * @returns {string}
   */
  convertFile(filePath) {
    const cssText = fs.readFileSync(path.resolve(filePath), 'utf8');
    return this.convertString(cssText);
  }

  /**
   * Convert a CSS string to a .style YAML string.
   * @param {string} cssText
   * @returns {string}
   */
  convertString(cssText) {
    const result = this._convert(cssText);
    return this._toStyleFile(result);
  }

  // ─── Reverse property mapper ─────────────────────────────────────────────────

  _reverseMap(decls) {
    const d   = { ...decls };
    const out = {};

    if (d['display'] === 'flex' || d['display'] === 'inline-flex') {
      if (d['display'] === 'inline-flex') out['display'] = 'inline-flex';
      out['layout'] = (d['flex-direction'] ?? 'row') === 'column' ? 'column' : 'row';
      delete d['display']; delete d['flex-direction'];
      if (d['align-items'] === 'center' && d['justify-content'] === 'center') {
        out['center'] = true;
        delete d['align-items']; delete d['justify-content'];
      }
    }

    if (d['padding'])          { out['padding']    = d['padding'];          delete d['padding']; }
    if (d['gap'])              { out['gap']        = d['gap'];              delete d['gap']; }
    if (d['background'])       { out['background'] = d['background'];       delete d['background']; }
    if (d['background-color']) { out['background'] = d['background-color']; delete d['background-color']; }
    if (d['border-radius'])    { out['radius']     = d['border-radius'];    delete d['border-radius']; }
    if (d['box-shadow'])       { out['shadow']     = d['box-shadow'];       delete d['box-shadow']; }
    if (d['cursor'])           { out['cursor']     = d['cursor'];           delete d['cursor']; }
    if (d['transition'])       { out['transition'] = d['transition'];       delete d['transition']; }
    if (d['transform'])        { out['transform']  = d['transform'];        delete d['transform']; }
    if (d['width'])            { out['width']      = d['width'];            delete d['width']; }
    if (d['height'])           { out['height']     = d['height'];           delete d['height']; }
    if (d['font-size'])        { out['size']       = d['font-size'];        delete d['font-size']; }
    if (d['font-weight'])      { out['weight']     = this._weightLabel(d['font-weight']); delete d['font-weight']; }
    if (d['color'])            { out['color']      = d['color'];            delete d['color']; }
    if (d['margin-top'])       { out['margin-top']    = d['margin-top'];    delete d['margin-top']; }
    if (d['margin-bottom'])    { out['margin-bottom'] = d['margin-bottom']; delete d['margin-bottom']; }

    return { intents: out, leftovers: d };
  }

  _weightLabel(v) {
    if (v === '700' || v === 'bold')     return 'bold';
    if (v === '600' || v === 'semibold') return 'semibold';
    if (v === '400' || v === 'normal')   return 'normal';
    if (v === '300' || v === 'light')    return 'light';
    return v;
  }

  // ─── Selector parser ─────────────────────────────────────────────────────────

  /**
   * Normalise one simple selector fragment into { name, selectorType }.
   * Returns null for attribute selectors or functional pseudo-classes.
   */
  _normalizePart(part) {
    if (/[\[\(]/.test(part)) return null;
    part = part.replace(/::[\w-]+$/, '').trim();
    if (!part) return null;

    const idM = part.match(/#([\w-]+)/);
    if (idM) return { name: idM[1], selectorType: 'id' };

    const clsM = part.match(/\.([\w-]+)/);
    if (clsM) return { name: clsM[1], selectorType: 'class' };

    if (/^[a-z][a-z0-9-]*$/.test(part)) return { name: part, selectorType: 'tag' };
    return null;
  }

  _toBase(norm) {
    return (norm.selectorType === 'id' ? '#' : '.') + norm.name;
  }

  _parseSelector(rawSel) {
    let sel = rawSel.trim();
    if (sel.includes(',')) return { type: 'complex', raw: rawSel };

    // Normalise all combinators (>, ~, +) → space
    sel = sel.replace(/\s*[>~+]\s*/g, ' ').trim();

    // Extract trailing simple :pseudo-state (not functional like :not(), :nth-child())
    let state = null;
    const pseudoM = sel.match(/:([\w-]+)$/);
    if (pseudoM) {
      const candidate = pseudoM[1];
      const before    = sel.slice(0, sel.lastIndexOf(':' + candidate));
      if (!before.endsWith('(')) {
        state = candidate;
        sel   = before.trim();
      }
    }

    const rawParts = sel.split(/\s+/).filter(Boolean);
    if (!rawParts.length) return { type: 'complex', raw: rawSel };

    const parts = rawParts.map(p => this._normalizePart(p));
    if (parts.some(p => p === null)) return { type: 'complex', raw: rawSel };

    // 1 part
    if (parts.length === 1) {
      const base = this._toBase(parts[0]);
      return state ? { type: 'state', base, state } : { type: 'base', base };
    }

    // 2 parts
    if (parts.length === 2) {
      const base  = this._toBase(parts[0]);
      const child = parts[1].name;
      return state
        ? { type: 'child-state', base, child, state }
        : { type: 'child', base, child };
    }

    // 3+ parts → flatten: first part + last part
    const base  = this._toBase(parts[0]);
    const child = parts[parts.length - 1].name;
    return state
      ? { type: 'child-state', base, child, state, approx: true }
      : { type: 'child',       base, child,         approx: true };
  }

  // ─── Declarations → map ──────────────────────────────────────────────────────

  _declsToMap(declarations = []) {
    const map = {};
    for (const d of declarations) {
      if (d.type === 'declaration') {
        map[d.property] = (d.value ?? '').replace(/\s*!important/, '').trim();
      }
    }
    return map;
  }

  // ─── Token extractor ─────────────────────────────────────────────────────────

  _extractTokens(components) {
    const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^hsl/;
    const counts   = new Map();

    const scan = obj => {
      if (!obj || typeof obj !== 'object') return;
      for (const v of Object.values(obj)) {
        if (typeof v === 'string' && COLOR_RE.test(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
        else scan(v);
      }
    };
    for (const comp of Object.values(components)) scan(comp);

    const tokens = {};
    let idx = 1;
    for (const [val, count] of counts) {
      if (count >= 2) tokens[`color-${idx++}`] = val;
    }
    return tokens;
  }

  _substituteTokens(obj, tokenByVal) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && tokenByVal.has(v)) out[k] = tokenByVal.get(v);
      else if (typeof v === 'object')                  out[k] = this._substituteTokens(v, tokenByVal);
      else                                             out[k] = v;
    }
    return out;
  }

  // ─── Core conversion ─────────────────────────────────────────────────────────

  _convert(cssText) {
    const ast        = css.parse(cssText, { silent: true });
    const components = {};
    const skipped    = [];

    const getComp = key => {
      if (!components[key]) {
        components[key] = { base: {}, states: {}, children: {}, childStates: {}, media: {} };
      }
      return components[key];
    };

    const processRule = (rule, mediaQuery = null) => {
      const rawDecls = this._declsToMap(rule.declarations);
      if (!Object.keys(rawDecls).length) return;

      for (const rawSel of (rule.selectors ?? [])) {
        const parsed = this._parseSelector(rawSel);

        if (parsed.type === 'complex') {
          skipped.push({ sel: parsed.raw, decls: rawDecls });
          continue;
        }

        const comp = getComp(parsed.base);

        if (mediaQuery) {
          comp.media[mediaQuery] ??= { base: {}, states: {} };
          if (parsed.type === 'base') {
            Object.assign(comp.media[mediaQuery].base, rawDecls);
          } else if (parsed.type === 'state') {
            comp.media[mediaQuery].states[parsed.state] ??= {};
            Object.assign(comp.media[mediaQuery].states[parsed.state], rawDecls);
          }
          // child/child-state inside @media not supported by style-parser
        } else {
          if (parsed.type === 'base') {
            Object.assign(comp.base, rawDecls);
          } else if (parsed.type === 'state') {
            comp.states[parsed.state] ??= {};
            Object.assign(comp.states[parsed.state], rawDecls);
          } else if (parsed.type === 'child') {
            comp.children[parsed.child] ??= {};
            Object.assign(comp.children[parsed.child], rawDecls);
          } else if (parsed.type === 'child-state') {
            comp.childStates[parsed.child]                ??= {};
            comp.childStates[parsed.child][parsed.state]  ??= {};
            Object.assign(comp.childStates[parsed.child][parsed.state], rawDecls);
          }
        }
      }
    };

    for (const node of (ast.stylesheet?.rules ?? [])) {
      if (node.type === 'rule') {
        processRule(node);
      } else if (node.type === 'media') {
        for (const inner of (node.rules ?? [])) {
          if (inner.type === 'rule') processRule(inner, node.media);
        }
      }
    }

    // Build style components
    const rawTokens      = this._extractTokens(components);
    const tokenByVal     = new Map(Object.entries(rawTokens).map(([k, v]) => [v, k]));
    const styleComponents = {};

    for (const [sel, comp] of Object.entries(components)) {
      const isId = sel.startsWith('#');
      const name = sel.replace(/^[.#]/, '');

      const { intents: baseIntents, leftovers: baseRaw } = this._reverseMap({ ...comp.base });
      const entry = isId
        ? { type: 'id',    ...baseIntents, ...baseRaw }
        : { type: 'class', ...baseIntents, ...baseRaw };

      // States
      if (Object.keys(comp.states).length) {
        entry.states = {};
        for (const [state, decls] of Object.entries(comp.states)) {
          const { intents, leftovers } = this._reverseMap({ ...decls });
          entry.states[state] = { ...intents, ...leftovers };
        }
      }

      // Children + their states merged
      const allChildren = new Set([...Object.keys(comp.children), ...Object.keys(comp.childStates)]);
      for (const child of allChildren) {
        const { intents, leftovers } = this._reverseMap({ ...(comp.children[child] ?? {}) });
        const childEntry = { ...intents, ...leftovers };

        const childSts = comp.childStates[child] ?? {};
        if (Object.keys(childSts).length) {
          childEntry.states = {};
          for (const [state, decls] of Object.entries(childSts)) {
            const { intents: si, leftovers: sl } = this._reverseMap({ ...decls });
            childEntry.states[state] = { ...si, ...sl };
          }
        }
        entry[child] = childEntry;
      }

      // Media
      if (Object.keys(comp.media).length) {
        entry.media = {};
        for (const [query, mqBlock] of Object.entries(comp.media)) {
          entry.media[query] = {};
          if (Object.keys(mqBlock.base).length) {
            const { intents, leftovers } = this._reverseMap({ ...mqBlock.base });
            Object.assign(entry.media[query], intents, leftovers);
          }
          if (Object.keys(mqBlock.states).length) {
            entry.media[query].states = {};
            for (const [state, decls] of Object.entries(mqBlock.states)) {
              const { intents, leftovers } = this._reverseMap({ ...decls });
              entry.media[query].states[state] = { ...intents, ...leftovers };
            }
          }
        }
      }

      styleComponents[name] = this._substituteTokens(entry, tokenByVal);
    }

    return {
      tokens:     rawTokens,
      components: styleComponents,
      skipped,
      stats: {
        components: Object.keys(styleComponents).length,
        tokens:     Object.keys(rawTokens).length,
        skipped:    skipped.length,
      },
    };
  }

  // ─── YAML serializer ─────────────────────────────────────────────────────────

  _toStyleFile({ tokens, components, skipped }) {
    const lines = [];

    if (Object.keys(tokens).length) {
      lines.push('tokens:');
      for (const [k, v] of Object.entries(tokens)) lines.push(`  ${k}: "${v}"`);
      lines.push('');
    }

    lines.push('components:');
    for (const [key, def] of Object.entries(components)) {
      lines.push('');
      lines.push(`  ${key}:`);
      this._serializeBlock(def, lines, 4);
    }

    if (skipped.length) {
      lines.push('');
      lines.push('# ─── Complex selectors (not converted) ─────────────────────────────────────');
      for (const { sel, decls } of skipped) {
        lines.push(`# ${sel}`);
        for (const [prop, val] of Object.entries(decls)) lines.push(`#   ${prop}: ${val}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  _serializeBlock(obj, lines, indent) {
    const pad = ' '.repeat(indent);
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'boolean') {
        lines.push(`${pad}${k}: ${v}`);
      } else if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) {
        const needsKeyQuote = /[:#,\[\]{}&*!|>'"%@`\(\)]/.test(k) || k.trim() !== k;
        lines.push(needsKeyQuote ? `${pad}"${k}":` : `${pad}${k}:`);
        this._serializeBlock(v, lines, indent + 2);
      } else if (typeof v === 'string') {
        const needsQuote = /[:#,\[\]{}&*!|>'"%@`]/.test(v) || v.trim() !== v;
        lines.push(needsQuote
          ? `${pad}${k}: "${v.replace(/"/g, '\\"')}"`
          : `${pad}${k}: ${v}`);
      } else {
        lines.push(`${pad}${k}: ${v}`);
      }
    }
  }
}

module.exports = CSSConverter;
