'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Importer
 *
 * Résout les directives `@import` dans les fichiers .style avant le parsing YAML.
 * La syntaxe est une ligne YAML commentée (invisible pour js-yaml) :
 *
 *   # @import "./tokens.style"
 *   # @import "./buttons/base.style"
 *
 * L'importer fusionne récursivement les blocs `tokens` et `components`
 * de chaque fichier importé, dans l'ordre de déclaration.
 * Les composants du fichier principal ont priorité sur les imports.
 *
 * Exemple :
 *   tokens.style  →  déclare les tokens de base
 *   button.style  →  @import "./tokens.style" + déclare ses composants
 */
class Importer {
  constructor() {
    this._visited = new Set(); // protection contre les imports circulaires
  }

  /**
   * Charge un fichier .style en résolvant tous ses imports récursivement.
   * @param {string} filePath  Chemin absolu vers le fichier racine
   * @returns {{ tokens: object, components: object, source: string }}
   */
  load(filePath) {
    this._visited.clear();
    return this._loadFile(path.resolve(filePath));
  }

  /**
   * Même chose depuis une chaîne YAML (les imports sont résolus relativement à cwd).
   * @param {string} yamlString
   * @param {string} [baseDir=process.cwd()]
   */
  loadString(yamlString, baseDir = process.cwd()) {
    this._visited.clear();
    return this._loadString(yamlString, baseDir, '<string>');
  }

  // ─── Interne ─────────────────────────────────────────────────────────────────

  _loadFile(absPath) {
    if (this._visited.has(absPath)) {
      throw new Error(`Import circulaire détecté: ${absPath}`);
    }
    this._visited.add(absPath);

    if (!fs.existsSync(absPath)) {
      throw new Error(`Fichier importé introuvable: ${absPath}`);
    }

    const raw     = fs.readFileSync(absPath, 'utf8');
    const baseDir = path.dirname(absPath);
    return this._loadString(raw, baseDir, absPath);
  }

  _loadString(raw, baseDir, source) {
    const importPaths = this._extractImports(raw);
    const stripped    = this._stripImports(raw);
    this._checkDuplicateKeys(stripped, source);

    let doc;
    try {
      doc = yaml.load(stripped) ?? {};
    } catch (err) {
      throw new Error(`YAML invalide dans ${source}: ${err.message}`);
    }

    // Base vide
    let merged = {
      tokens:     doc.tokens     ?? {},
      components: doc.components ?? {},
    };

    // Résoudre les imports dans l'ordre et fusionner
    for (const importPath of importPaths) {
      const abs      = path.resolve(baseDir, importPath);
      const imported = this._loadFile(abs);
      merged = this._merge(imported, merged); // le fichier courant gagne
    }

    return { ...merged, source };
  }

  /**
   * Vérifie qu'il n'y a pas de clés dupliquées dans le bloc `components`.
   * Lève une erreur explicite si c'est le cas.
   */
  _checkDuplicateKeys(raw, source) {
    const KEY_RE = /^( {2})([A-Za-z_#.][A-Za-z0-9_#.\-]*):\s*$/gm;
    const seen = new Set();
    let m;
    while ((m = KEY_RE.exec(raw)) !== null) {
      if (seen.has(m[2])) {
        throw new Error(
          `Clé dupliquée "${m[2]}" dans ${source}. ` +
          `Utilisez "type: id" ou "type: class" sur une clé unique, ` +
          `ou les préfixes "#${m[2]}" / ".${m[2]}".`
        );
      }
      seen.add(m[2]);
    }
  }

  /**
   * Extrait les chemins depuis les lignes `# @import "..."`.
   */
  _extractImports(raw) {
    const re = /^#\s*@import\s+"([^"]+)"/gm;
    const paths = [];
    let m;
    while ((m = re.exec(raw)) !== null) {
      paths.push(m[1]);
    }
    return paths;
  }

  /**
   * Retire les lignes @import du YAML pour que js-yaml ne les voie pas.
   */
  _stripImports(raw) {
    return raw.replace(/^#\s*@import\s+"[^"]+"\s*$/gm, '');
  }

  /**
   * Fusionne deux documents. `override` a priorité sur `base`.
   */
  _merge(base, override) {
    return {
      tokens:     { ...base.tokens,     ...override.tokens     },
      components: { ...base.components, ...override.components },
    };
  }
}

module.exports = Importer;