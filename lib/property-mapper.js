'use strict';

const MAPPERS = {
  layout(value) {
    const rules = { display: 'flex' };
    rules['flex-direction'] = value === 'row' ? 'row' : 'column';
    return rules;
  },
  center(value) {
    if (value !== true && value !== 'true') return {};
    return { 'align-items': 'center', 'justify-content': 'center' };
  },
  display(value)      { return { display: value }; },
  padding(value)      { return { padding: value }; },
  'margin-top'(value) { return { 'margin-top': value }; },
  'margin-bottom'(value) { return { 'margin-bottom': value }; },
  gap(value)          { return { gap: value }; },
  background(value)   { return { background: value }; },
  radius(value)       { return { 'border-radius': value }; },
  shadow(value)       { return { 'box-shadow': value }; },
  cursor(value)       { return { cursor: value }; },
  transition(value)   { return { transition: value }; },
  transform(value)    { return { transform: value }; },
  width(value)        { return { width: value }; },
  height(value)       { return { height: value }; },
  size(value)         { return { 'font-size': value }; },
  weight(value) {
    const weights = { bold: '600', semibold: '500', normal: '400', light: '300' };
    return { 'font-weight': weights[value] ?? value };
  },
  color(value) { return { color: value }; },
};

/**
 * Reserved keys — handled by the parser itself, not mapped to CSS.
 */
const RESERVED_KEYS = new Set(['extends', 'states', 'type', 'media']);

function mapProperty(key, value) {
  if (RESERVED_KEYS.has(key)) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return {};
  const mapper = MAPPERS[key];
  if (mapper) return mapper(value);
  return { [key]: value };
}

function mapProperties(props) {
  const css = {};
  for (const [key, value] of Object.entries(props)) {
    Object.assign(css, mapProperty(key, value));
  }
  return css;
}

module.exports = { mapProperties, mapProperty, RESERVED_KEYS };
