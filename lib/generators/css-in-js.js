'use strict';

/**
 * CSSinJSGenerator
 *
 * Converts the normalized component tree into a CommonJS module
 * with camelCase style objects (React, Emotion, Styled-Components object syntax, etc.).
 *
 * Media queries are included as nested keys:
 *   btn['@media (max-width: 768px)'] = { padding: '4px 8px' }
 *
 * Each export also carries a `_selector` field ('.btn' or '#main-header').
 */
class CSSinJSGenerator {
  generate(parsed) {
    const { components, variables = {} } = parsed;
    const exports = [];
    const names   = [];

    for (const [name, component] of Object.entries(components)) {
      const prefix   = component.selectorType === 'id' ? '#' : '.';
      const selector = `${prefix}${name}`;
      const obj      = { _selector: selector };

      // Base styles
      for (const [prop, value] of Object.entries(component.css ?? {})) {
        obj[this._camel(prop)] = value;
      }

      // States — ':hover': { … }
      for (const [state, css] of Object.entries(component.states ?? {})) {
        obj[`:${state}`] = this._camelObj(css);
      }

      // Children
      for (const [childName, child] of Object.entries(component.children ?? {})) {
        const childObj = this._camelObj(child.css ?? {});

        // Child media queries
        for (const [query, mqBlock] of Object.entries(child.media ?? {})) {
          const resolvedQuery = variables[query] ?? query;
          childObj[`@media ${resolvedQuery}`] = this._camelObj(mqBlock.css ?? {});
        }

        obj[childName] = childObj;
      }

      // Component-level media queries
      for (const [query, mqBlock] of Object.entries(component.media ?? {})) {
        const resolvedQuery = variables[query] ?? query;
        const mqObj = this._camelObj(mqBlock.css ?? {});

        for (const [state, css] of Object.entries(mqBlock.states ?? {})) {
          mqObj[`:${state}`] = this._camelObj(css);
        }

        obj[`@media ${resolvedQuery}`] = mqObj;
      }

      const varName = this._camel(name);
      names.push(varName);
      exports.push(`const ${varName} = ${this._serialize(obj)};`);
    }

    const footer = names.length
      ? `\nmodule.exports = { ${names.join(', ')} };\n`
      : '\nmodule.exports = {};\n';

    return `'use strict';\n\n` + exports.join('\n\n') + footer;
  }

  _camel(str) {
    return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  _camelObj(css) {
    const out = {};
    for (const [prop, value] of Object.entries(css)) {
      out[this._camel(prop)] = value;
    }
    return out;
  }

  _serialize(obj, depth = 0) {
    const pad  = '  '.repeat(depth + 1);
    const pad0 = '  '.repeat(depth);
    const entries = Object.entries(obj);
    if (!entries.length) return '{}';

    const lines = entries.map(([k, v]) => {
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : `'${k}'`;
      if (typeof v === 'object' && v !== null) {
        return `${pad}${key}: ${this._serialize(v, depth + 1)},`;
      }
      return `${pad}${key}: '${v}',`;
    });

    return `{\n${lines.join('\n')}\n${pad0}}`;
  }
}

module.exports = CSSinJSGenerator;
