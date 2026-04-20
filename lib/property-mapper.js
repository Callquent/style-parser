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

  // ─── Box model ─────────────────────────────────────────────────────────────

  // margin
  margin(value)         { return { margin: value }; },
  'margin-top'(value)   { return { 'margin-top': value }; },
  'margin-right'(value) { return { 'margin-right': value }; },
  'margin-bottom'(value){ return { 'margin-bottom': value }; },
  'margin-left'(value)  { return { 'margin-left': value }; },

  // padding
  padding(value)          { return { padding: value }; },
  'padding-top'(value)    { return { 'padding-top': value }; },
  'padding-right'(value)  { return { 'padding-right': value }; },
  'padding-bottom'(value) { return { 'padding-bottom': value }; },
  'padding-left'(value)   { return { 'padding-left': value }; },

  // sizing
  width(value)      { return { width: value }; },
  height(value)     { return { height: value }; },
  'min-width'(value)  { return { 'min-width': value }; },
  'max-width'(value)  { return { 'max-width': value }; },
  'min-height'(value) { return { 'min-height': value }; },
  'max-height'(value) { return { 'max-height': value }; },

  // border
  border(value)         { return { border: value }; },
  'border-top'(value)   { return { 'border-top': value }; },
  'border-right'(value) { return { 'border-right': value }; },
  'border-bottom'(value){ return { 'border-bottom': value }; },
  'border-left'(value)  { return { 'border-left': value }; },
  'border-color'(value) { return { 'border-color': value }; },
  'border-width'(value) { return { 'border-width': value }; },
  'border-style'(value) { return { 'border-style': value }; },

  // aliases courts (utilisables directement dans box: ou attrs:)
  radius(value)  { return { 'border-radius': value }; },
  shadow(value)  { return { 'box-shadow': value }; },
  sizing(value)  { return { 'box-sizing': value }; },

  // overflow
  overflow(value)   { return { overflow: value }; },
  'overflow-x'(value) { return { 'overflow-x': value }; },
  'overflow-y'(value) { return { 'overflow-y': value }; },

  // position
  position(value) { return { position: value }; },
  top(value)      { return { top: value }; },
  right(value)    { return { right: value }; },
  bottom(value)   { return { bottom: value }; },
  left(value)     { return { left: value }; },
  'z-index'(value){ return { 'z-index': value }; },

  // ─── Layout ────────────────────────────────────────────────────────────────

  gap(value)            { return { gap: value }; },
  'flex-wrap'(value)    { return { 'flex-wrap': value }; },
  'flex-grow'(value)    { return { 'flex-grow': value }; },
  'flex-shrink'(value)  { return { 'flex-shrink': value }; },
  'flex-basis'(value)   { return { 'flex-basis': value }; },
  flex(value)           { return { flex: value }; },
  'align-items'(value)  { return { 'align-items': value }; },
  'align-self'(value)   { return { 'align-self': value }; },
  'justify-content'(value) { return { 'justify-content': value }; },

  // ─── Appearance ────────────────────────────────────────────────────────────

  background(value)   { return { background: value }; },
  opacity(value)      { return { opacity: value }; },
  cursor(value)       { return { cursor: value }; },
  transition(value)   { return { transition: value }; },
  transform(value)    { return { transform: value }; },

  // ─── Typography ────────────────────────────────────────────────────────────

  size(value)    { return { 'font-size': value }; },
  weight(value) {
    const weights = { bold: '600', semibold: '500', normal: '400', light: '300' };
    return { 'font-weight': weights[value] ?? value };
  },
  color(value)         { return { color: value }; },
  'line-height'(value) { return { 'line-height': value }; },
  'letter-spacing'(value) { return { 'letter-spacing': value }; },
  'text-align'(value)  { return { 'text-align': value }; },
  'text-transform'(value) { return { 'text-transform': value }; },
  'text-decoration'(value) { return { 'text-decoration': value }; },
  'white-space'(value) { return { 'white-space': value }; },
  'word-break'(value)  { return { 'word-break': value }; },
  'font-family'(value) { return { 'font-family': value }; },
  'font-style'(value)  { return { 'font-style': value }; },
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
