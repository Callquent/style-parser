'use strict';

/**
 * Resolves token references in property values.
 * Tokens are referenced by their key name (e.g., "color-primary")
 * and replaced with their actual value at parse time.
 */
class TokenResolver {
  constructor(tokens = {}) {
    this.tokens = tokens;
  }

  resolve(value) {
    if (typeof value === 'string') {
      return this.tokens[value] ?? value;
    }
    if (Array.isArray(value)) {
      return value.map(v => this.resolve(v)).join(' ');
    }
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

module.exports = TokenResolver;
