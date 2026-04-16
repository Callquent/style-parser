'use strict';

const yaml = require('js-yaml');
const { mapProperty } = require('./property-mapper');

/**
 * Linter
 *
 * Analyse un fichier .ycss et retourne une liste de diagnostics
 * sans faire planter le process. Utilisé par le CLI (--lint) et
 * intégrable dans des éditeurs via l'API.
 *
 * Chaque diagnostic :
 * {
 *   severity: 'error' | 'warning' | 'info',
 *   code:     string,   // identifiant stable (ex: "unknown-mapper")
 *   message:  string,
 *   path:     string,   // ex: "components.btn.label.size"
 * }
 */
class Linter {
  constructor() {
    this.diagnostics = [];
  }

  /**
   * @param {string} yamlString
   * @returns {{ ok: boolean, diagnostics: Diagnostic[] }}
   */
  lint(yamlString) {
    this.diagnostics = [];
    let doc;

    try {
      doc = yaml.load(yamlString);
    } catch (err) {
      this._error('yaml-parse', err.message, '<root>');
      return this._result();
    }

    if (!doc || typeof doc !== 'object') {
      this._error('empty-file', 'Le fichier est vide ou invalide.', '<root>');
      return this._result();
    }

    this._lintTokens(doc.tokens ?? {});
    this._lintComponents(doc.components ?? {}, doc.tokens ?? {});

    return this._result();
  }

  // ─── Tokens ─────────────────────────────────────────────────────────────────

  _lintTokens(tokens) {
    for (const [name, value] of Object.entries(tokens)) {
      const path = `tokens.${name}`;

      if (typeof value !== 'string') {
        this._error('token-not-string', `La valeur du token doit être une chaîne, reçu: ${typeof value}`, path);
        continue;
      }

      // Avertir les tokens qui semblent être des couleurs sans guillemets hex corrects
      if (/^#[0-9a-fA-F]{3,8}$/.test(value) === false && value.startsWith('#')) {
        this._warn('invalid-color', `Couleur hex suspecte: "${value}"`, path);
      }

      // Noms de tokens avec espaces
      if (/\s/.test(name)) {
        this._error('token-whitespace', `Le nom du token ne doit pas contenir d'espaces.`, path);
      }
    }
  }

  // ─── Components ─────────────────────────────────────────────────────────────

  _lintComponents(components, tokens) {
    const names = Object.keys(components);

    for (const [name, def] of Object.entries(components)) {
      const path = `components.${name}`;

      if (!def || typeof def !== 'object') {
        this._error('component-not-object', `Le composant doit être un objet.`, path);
        continue;
      }

      // extends valide
      if (def.extends !== undefined) {
        if (!components[def.extends]) {
          this._error('unknown-extends',
            `"${name}" étend "${def.extends}" qui n'existe pas.`,
            `${path}.extends`);
        }
        if (def.extends === name) {
          this._error('self-extends', `Un composant ne peut pas s'étendre lui-même.`, `${path}.extends`);
        }
      }

      // Linter les props de base
      this._lintProps(def, path, tokens, names);

      // States
      if (def.states) {
        this._lintStates(def.states, path, tokens);
      }
    }
  }

  _lintProps(def, basePath, tokens, componentNames) {
    const KNOWN_INTENTS = new Set([
      'layout', 'center', 'padding', 'gap', 'background', 'radius', 'shadow',
      'cursor', 'transition', 'transform', 'width', 'height', 'display',
      'margin-top', 'margin-bottom', 'size', 'weight', 'color',
      'extends', 'states',
    ]);

    for (const [key, value] of Object.entries(def)) {
      const path = `${basePath}.${key}`;

      // Blocs enfants (objets avec des clés d'intention)
      if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
        if (key !== 'states') {
          this._lintProps(value, path, tokens, componentNames);
        }
        continue;
      }

      // Clé inconnue
      if (!KNOWN_INTENTS.has(key)) {
        // Essayons de mapper en passthrough — si mapProperty produit quelque chose, c'est ok
        const result = mapProperty(key, value);
        if (Object.keys(result).length === 0 && !KNOWN_INTENTS.has(key)) {
          this._warn('unknown-intent',
            `Clé inconnue "${key}" — elle sera transmise telle quelle au CSS.`,
            path);
        }
      }

      // Référence de token qui n'existe pas
      if (typeof value === 'string' && tokens && !(value in tokens)) {
        // Ce n'est pas forcément une ref token, on ne warn que si ça ressemble à un nom de token
        if (/^[a-z][a-z0-9-]+$/.test(value) && !value.includes(' ') && value.length > 2) {
          // Valeurs CSS communes à ne pas confondre avec des tokens
          const CSS_KEYWORDS = new Set(['row', 'column', 'pointer', 'none', 'auto',
            'bold', 'normal', 'semibold', 'light', 'true', 'false', 'center',
            'pill', 'rounded', 'soft', 'medium', 'inline-flex', 'flex',
            'inherit', 'initial', 'unset', 'revert']);
          if (!CSS_KEYWORDS.has(value)) {
            this._info('possible-missing-token',
              `"${value}" ressemble à un token mais n'est pas déclaré dans tokens.`,
              path);
          }
        }
      }

      // layout doit être 'row' ou 'column'
      if (key === 'layout' && !['row', 'column'].includes(value)) {
        this._error('invalid-layout',
          `layout doit être "row" ou "column", reçu: "${value}"`,
          path);
      }

      // weight doit être une valeur connue
      if (key === 'weight' && !['bold', 'semibold', 'normal', 'light'].includes(value)
          && isNaN(Number(value))) {
        this._warn('unknown-weight',
          `weight "${value}" inconnu. Valeurs: bold, semibold, normal, light.`,
          path);
      }
    }
  }

  _lintStates(states, basePath, tokens) {
    const KNOWN_STATES = new Set(['hover', 'focus', 'active', 'disabled',
      'focus-within', 'focus-visible', 'checked', 'placeholder']);

    for (const [state, props] of Object.entries(states)) {
      const path = `${basePath}.states.${state}`;
      if (!KNOWN_STATES.has(state)) {
        this._warn('unknown-state',
          `État "${state}" inhabituel — vérifiez la syntaxe CSS.`,
          path);
      }
      if (props && typeof props === 'object') {
        this._lintProps(props, path, tokens, []);
      }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _error(code, message, path) {
    this.diagnostics.push({ severity: 'error', code, message, path });
  }
  _warn(code, message, path) {
    this.diagnostics.push({ severity: 'warning', code, message, path });
  }
  _info(code, message, path) {
    this.diagnostics.push({ severity: 'info', code, message, path });
  }

  _result() {
    const hasErrors = this.diagnostics.some(d => d.severity === 'error');
    return { ok: !hasErrors, diagnostics: this.diagnostics };
  }
}

module.exports = Linter;
