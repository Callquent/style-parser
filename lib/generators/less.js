'use strict';

/**
 * LessConverter — pure JS, zero dependencies.
 * Converts Less to plain CSS for use with CSSConverter.
 *
 * Supported: variables, nesting, & parent selector,
 * @media nesting, arithmetic, darken/lighten, // comments.
 */
class LessConverter {

  convert(lessText) {
    const cleaned   = this._stripComments(lessText);
    const variables = this._collectVariables(cleaned);
    const expanded  = this._substituteVariables(cleaned, variables);
    const tokens    = this._tokenize(expanded);
    const rules     = this._flatten(tokens, [], null);
    return this._render(rules);
  }

  // ─── Step 1: Strip comments ───────────────────────────────────────────────

  _stripComments(text) {
    text = text.replace(/\/\*[\s\S]*?\*\//g, '');
    text = text.replace(/\/\/[^\n]*/g, '');
    text = text.replace(/^@import\s+[^\n]*\n?/gm, '');
    // Handle Magento-style conditional guards: "& when (...) { ... }"
    // Strip the guard wrapper but keep the inner content
    text = this._stripMagentoGuards(text);
    return text;
  }

  /**
   * Lifts the content of "& when (...) { ... }" blocks to the root level.
   * The guard wrapper is removed entirely; its children become top-level rules.
   */
  _liftGuardedBlocks(text) {
    const re = /&\s+when\s*\([^)]*\)\s*(?=\{)/g;
    let match;
    const blocks = [];
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      const braceStart = text.indexOf('{', match.index + match[0].length - 1);
      if (braceStart === -1) continue;
      const closeIdx = this._findClose(text, braceStart + 1);
      const inner = text.slice(braceStart + 1, closeIdx);
      blocks.push({ start: match.index, end: closeIdx + 1, inner });
    }
    if (!blocks.length) return text;
    let out = '', pos = 0;
    for (const b of blocks) {
      out += text.slice(pos, b.start);
      out += b.inner; // lift inner content as-is
      pos = b.end;
    }
    out += text.slice(pos);
    return out;
  }


  /**
   * Handles Magento Less media-width mixin pattern:
   *
   * 1. "& when (@media-common = true) { ... }" → handled by _liftGuardedBlocks
   *
   * 2. ".media-width(@extremum, @break) when (@extremum = 'max') and (@break = @screen__m) { ... }"
   *    → @media (max-width: 768px) { ... }
   *
   * 3. ".media-width(@extremum, @break) when (@extremum = 'min') and (@break = @screen__m) { ... }"
   *    → @media (min-width: 768px) { ... }
   *
   * The extremum ('min'/'max') is extracted from the when-clause.
   * The breakpoint value (px) is looked up from the @screen__ token.
   */
  _stripMagentoGuards(text) {
    // Breakpoints: token → pixel value only (extremum added dynamically)
    const BREAKPOINT_PX = {
      '@screen__xs': '480px',
      '@screen__m':  '768px',
      '@screen__l':  '1024px',
      '@screen__xl': '1280px',
    };

    // Pass 1: lift "& when (@media-common = true) { ... }" to root level
    text = this._liftGuardedBlocks(text);

    // Pass 2: convert .media-width(...) blocks
    // Regex captures the full declaration header up to (but not including) the opening brace
    const re = /\.media-width\s*\([^)]*\)\s*(?:when\s*(?:\([^)]*\)\s*(?:and\s*)?)+)?(?=\{)/g;
    const blocks = [];
    let match;
    re.lastIndex = 0;

    while ((match = re.exec(text)) !== null) {
      const header    = match[0];
      const start     = match.index;
      const braceStart = text.indexOf('{', start + header.length - 1);
      if (braceStart === -1) continue;
      const closeIdx = this._findClose(text, braceStart + 1);
      const inner    = text.slice(braceStart + 1, closeIdx);

      // Extract extremum: look for @extremum = 'min' or @extremum = 'max'
      // The full condition string spans from the header start to the brace
      const condStr  = text.slice(start, braceStart);
      const extMatch = condStr.match(/@extremum\s*=\s*'(min|max)'/);
      const extremum = extMatch ? extMatch[1] : 'max'; // default max

      // Extract breakpoint token from condition string
      let px = null;
      for (const [token, value] of Object.entries(BREAKPOINT_PX)) {
        if (condStr.includes(token)) { px = value; break; }
      }

      let mediaQuery = null;
      if (px) {
        mediaQuery = `(${extremum}-width: ${px})`;
      }

      blocks.push({ start, end: closeIdx + 1, inner, mediaQuery });
    }

    if (!blocks.length) return text;

    let out = '', pos = 0;
    for (const b of blocks) {
      out += text.slice(pos, b.start);
      if (b.mediaQuery) {
        out += `@media ${b.mediaQuery} {\n${b.inner}\n}`;
      }
      // blocks without a detected media query are dropped (unrecognised guard)
      pos = b.end;
    }
    out += text.slice(pos);
    return out;
  }

  // ─── Step 2: Variables ────────────────────────────────────────────────────

  _collectVariables(text) {
    const vars = {};
    const re = /@([\w-]+)\s*:\s*([^;{}]+);/g;
    let m;
    while ((m = re.exec(text)) !== null) vars['@' + m[1]] = m[2].trim();
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      for (const [k, v] of Object.entries(vars)) {
        const r = v.replace(/@[\w-]+/g, ref => {
          if (vars[ref] !== undefined) { changed = true; return vars[ref]; }
          return ref;
        });
        vars[k] = r;
      }
      if (!changed) break;
    }
    return vars;
  }

  _substituteVariables(text, vars) {
    text = text.replace(/@[\w-]+\s*:[^;{}]+;/g, '');
    text = text.replace(/@[\w-]+/g, ref => vars[ref] ?? ref);
    // Simple arithmetic
    text = text.replace(/(-?[\d.]+)(px|em|rem|%|vw|vh|s|ms)?\s*([+\-*\/])\s*(-?[\d.]+)(px|em|rem|%|vw|vh|s|ms)?/g,
      (_, a, ua, op, b, ub) => {
        const unit = ua || ub || '';
        const n = op==='+' ? +a + +b : op==='-' ? +a - +b : op==='*' ? +a * +b : +a / +b;
        return (+n.toFixed(4)).toString().replace(/\.?0+$/, '') + unit;
      });
    // darken/lighten
    text = text.replace(/(darken|lighten)\(\s*(#[0-9a-fA-F]{3,8})\s*,\s*([\d.]+)%\s*\)/g,
      (_, fn, color, pct) => this._adjustColor(color, parseFloat(pct), fn === 'darken' ? -1 : 1));
    return text;
  }

  // ─── Step 3: Tokenize ─────────────────────────────────────────────────────

  _tokenize(text) {
    const items = [];
    let i = 0;
    const len = text.length;

    while (i < len) {
      while (i < len && /\s/.test(text[i])) i++;
      if (i >= len || text[i] === '}') break;

      // Scan to next { ; or }
      let j = i;
      while (j < len && text[j] !== '{' && text[j] !== ';' && text[j] !== '}') j++;
      if (j >= len) break;

      if (text[j] === ';') {
        const decl = text.slice(i, j).trim();
        if (decl && decl.includes(':') && !decl.startsWith('@')) {
          items.push({ type: 'decl', value: decl });
        }
        i = j + 1;
      } else if (text[j] === '}') {
        const decl = text.slice(i, j).trim();
        if (decl && decl.includes(':') && !decl.startsWith('@')) {
          items.push({ type: 'decl', value: decl });
        }
        i = j;
        break;
      } else {
        // Found '{' — selector is everything from i to j
        const selector  = text.slice(i, j).trim();
        const closeIdx  = this._findClose(text, j + 1);
        const inner     = text.slice(j + 1, closeIdx);
        i = closeIdx + 1;
        if (selector) {
          items.push({ type: 'block', selector, children: this._tokenize(inner) });
        }
      }
    }
    return items;
  }

  _findClose(text, start) {
    let depth = 1, i = start;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    return i - 1;
  }

  // ─── Step 4: Flatten ──────────────────────────────────────────────────────

  _flatten(tokens, parentSelectors, mediaQuery) {
    const rules  = [];
    const decls  = tokens.filter(t => t.type === 'decl');
    const blocks = tokens.filter(t => t.type === 'block');

    if (decls.length && parentSelectors.length) {
      rules.push({ selector: parentSelectors.join(',\n'), decls: decls.map(d => d.value), mediaQuery });
    }

    for (const block of blocks) {
      const sel = block.selector.trim();
      if (sel.startsWith('@media')) {
        const mq = sel.slice('@media'.length).trim();
        rules.push(...this._flatten(block.children, parentSelectors, mq));
      } else if (sel.startsWith('@')) {
        // ignore other at-rules inside blocks
      } else {
        const resolved = this._resolveSelectors(sel, parentSelectors);
        rules.push(...this._flatten(block.children, resolved, mediaQuery));
      }
    }
    return rules;
  }

  _resolveSelectors(rawSel, parents) {
    const children = rawSel.split(',').map(s => s.trim()).filter(Boolean);
    if (!parents.length) return children;
    const result = [];
    for (const parent of parents) {
      for (const child of children) {
        result.push(child.includes('&') ? child.replace(/&/g, parent) : `${parent} ${child}`);
      }
    }
    return result;
  }

  // ─── Step 5: Render ───────────────────────────────────────────────────────

  _render(rules) {
    const regular = rules.filter(r => !r.mediaQuery);
    const media   = rules.filter(r =>  r.mediaQuery);

    const mediaMap = new Map();
    for (const r of media) {
      if (!mediaMap.has(r.mediaQuery)) mediaMap.set(r.mediaQuery, []);
      mediaMap.get(r.mediaQuery).push(r);
    }

    const blocks = [];

    for (const r of regular) {
      if (r.decls && r.decls.length) {
        blocks.push(`${r.selector} {\n${r.decls.map(d => `  ${d};`).join('\n')}\n}`);
      }
    }

    for (const [query, mrules] of mediaMap) {
      const inner = mrules
        .filter(r => r.decls && r.decls.length)
        .map(r => `  ${r.selector} {\n${r.decls.map(d => `    ${d};`).join('\n')}\n  }`)
        .join('\n\n');
      if (inner) blocks.push(`@media ${query} {\n${inner}\n}`);
    }

    return blocks.join('\n\n') + (blocks.length ? '\n' : '');
  }

  // ─── Color helpers ────────────────────────────────────────────────────────

  _adjustColor(hex, pct, direction) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    if (hex.length !== 6) return '#' + hex;
    let r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
    const [h, s, l] = this._rgbToHsl(r, g, b);
    const newL = Math.max(0, Math.min(1, l + direction * (pct / 100)));
    [r, g, b] = this._hslToRgb(h, s, newL);
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
  }

  _rgbToHsl(r, g, b) {
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b), l=(max+min)/2;
    if (max===min) return [0,0,l];
    const d=max-min, s=l>0.5 ? d/(2-max-min) : d/(max+min);
    let h;
    if      (max===r) h=((g-b)/d+(g<b?6:0))/6;
    else if (max===g) h=((b-r)/d+2)/6;
    else              h=((r-g)/d+4)/6;
    return [h,s,l];
  }

  _hslToRgb(h, s, l) {
    if (s===0) { const v=Math.round(l*255); return [v,v,v]; }
    const q=l<0.5 ? l*(1+s) : l+s-l*s, p=2*l-q;
    const f = t => {
      if (t<0) t+=1; if (t>1) t-=1;
      if (t<1/6) return p+(q-p)*6*t;
      if (t<1/2) return q;
      if (t<2/3) return p+(q-p)*(2/3-t)*6;
      return p;
    };
    return [Math.round(f(h+1/3)*255), Math.round(f(h)*255), Math.round(f(h-1/3)*255)];
  }
}

module.exports = LessConverter;
