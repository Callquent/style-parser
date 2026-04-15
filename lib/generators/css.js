'use strict';

/**
 * CSSGenerator
 *
 * Converts the normalized component tree into plain CSS.
 * Supports:
 *   - class (.) and id (#) selectors
 *   - pseudo-state rules  (.btn:hover)
 *   - child selectors     (.btn .label)
 *   - media queries       @media (max-width: 768px) { … }
 *     including states inside media blocks (.btn:hover inside @media)
 *
 * Media queries with the same condition are grouped into a single
 * @media block (appearing after all base rules).
 */
class CSSGenerator {
  generate(parsed) {
    const { components } = parsed;
    const blocks = [];

    // Map<query, string[]> — accumulates inner rule strings per media query
    const mediaMap = new Map();

    for (const [name, component] of Object.entries(components)) {
      const prefix   = component.selectorType === 'id' ? '#' : '.';
      const selector = `${prefix}${name}`;

      // Base styles
      const baseDecls = this._decls(component.css);
      if (baseDecls) blocks.push(`${selector} {\n${baseDecls}\n}`);

      // States
      for (const [state, css] of Object.entries(component.states ?? {})) {
        const decls = this._decls(css);
        if (decls) blocks.push(`${selector}:${state} {\n${decls}\n}`);
      }

      // Children (always class selectors)
      for (const [childName, child] of Object.entries(component.children ?? {})) {
        const decls = this._decls(child.css);
        if (decls) blocks.push(`${selector} .${childName} {\n${decls}\n}`);

        // Children media queries → grouped
        for (const [query, mqBlock] of Object.entries(child.media ?? {})) {
          const inner = this._decls(mqBlock.css, 4);
          if (inner) {
            this._addMedia(mediaMap, query,
              `  ${selector} .${childName} {\n${inner}\n  }`);
          }
        }
      }

      // Component-level media queries → grouped
      for (const [query, mqBlock] of Object.entries(component.media ?? {})) {
        const baseDecls = this._decls(mqBlock.css, 4);
        if (baseDecls) {
          this._addMedia(mediaMap, query, `  ${selector} {\n${baseDecls}\n  }`);
        }

        for (const [state, css] of Object.entries(mqBlock.states ?? {})) {
          const decls = this._decls(css, 4);
          if (decls) {
            this._addMedia(mediaMap, query, `  ${selector}:${state} {\n${decls}\n  }`);
          }
        }
      }
    }

    // Render grouped @media blocks
    const mediaBlocks = [];
    for (const [query, rules] of mediaMap) {
      mediaBlocks.push(`@media ${query} {\n${rules.join('\n\n')}\n}`);
    }

    const all = [...blocks, ...mediaBlocks];
    return all.join('\n\n') + (all.length ? '\n' : '');
  }

  /** Adds a rule string to the media map, creating the entry if needed. */
  _addMedia(map, query, ruleStr) {
    if (!map.has(query)) map.set(query, []);
    map.get(query).push(ruleStr);
  }

  _decls(css = {}, indent = 2) {
    const pad = ' '.repeat(indent);
    return Object.entries(css)
      .map(([prop, value]) => `${pad}${prop}: ${value};`)
      .join('\n');
  }
}

module.exports = CSSGenerator;
