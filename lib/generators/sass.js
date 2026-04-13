'use strict';

/**
 * SassGenerator
 *
 * Converts the normalized component tree into SCSS with nesting.
 * Supports:
 *   - class (.) and id (#) selectors
 *   - &:state nesting
 *   - .child nesting
 *   - @media nesting (SCSS native — no need to hoist)
 *     including states inside media blocks
 */
class SassGenerator {
  generate(parsed) {
    const { tokens, components } = parsed;
    const blocks = [];

    // Tokens → SCSS variables
    const tokenEntries = Object.entries(tokens ?? {});
    if (tokenEntries.length) {
      blocks.push(tokenEntries.map(([k, v]) => `$${k}: ${v};`).join('\n'));
    }

    for (const [name, component] of Object.entries(components)) {
      const prefix   = component.selectorType === 'id' ? '#' : '.';
      const selector = `${prefix}${name}`;
      const inner    = [];

      // Base declarations
      for (const [prop, value] of Object.entries(component.css ?? {})) {
        inner.push(`  ${prop}: ${value};`);
      }

      // States — &:hover { … }
      for (const [state, css] of Object.entries(component.states ?? {})) {
        const decls = this._decls(css, 4);
        if (decls) inner.push(`\n  &:${state} {\n${decls}\n  }`);
      }

      // Children — .label { … }
      for (const [childName, child] of Object.entries(component.children ?? {})) {
        const childInner = [];

        const decls = this._decls(child.css, 4);
        if (decls) childInner.push(decls);

        // Child media queries (nested inside .child)
        for (const [query, mqBlock] of Object.entries(child.media ?? {})) {
          const mqDecls = this._decls(mqBlock.css, 6);
          if (mqDecls) {
            childInner.push(`\n    @media ${query} {\n${mqDecls}\n    }`);
          }
        }

        if (childInner.length) {
          inner.push(`\n  .${childName} {\n${childInner.join('\n')}\n  }`);
        }
      }

      // Component-level media queries (nested inside selector)
      for (const [query, mqBlock] of Object.entries(component.media ?? {})) {
        const mqInner = [];

        const baseDecls = this._decls(mqBlock.css, 4);
        if (baseDecls) mqInner.push(baseDecls);

        for (const [state, css] of Object.entries(mqBlock.states ?? {})) {
          const decls = this._decls(css, 6);
          if (decls) mqInner.push(`\n    &:${state} {\n${decls}\n    }`);
        }

        if (mqInner.length) {
          inner.push(`\n  @media ${query} {\n${mqInner.join('\n')}\n  }`);
        }
      }

      blocks.push(`${selector} {\n${inner.join('\n')}\n}`);
    }

    return blocks.join('\n\n') + (blocks.length ? '\n' : '');
  }

  _decls(css = {}, indent = 2) {
    const pad = ' '.repeat(indent);
    return Object.entries(css)
      .map(([prop, value]) => `${pad}${prop}: ${value};`)
      .join('\n');
  }
}

module.exports = SassGenerator;
