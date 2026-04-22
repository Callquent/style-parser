'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * GroupLoader
 *
 * Charge le fichier groups.yaml et expose :
 *   - groupNames    : string[]           — noms de groupes dans l'ordre de déclaration
 *   - groupSets     : Map<name, Set>     — ensemble des propriétés par groupe
 *   - propToGroup   : Map<prop, name>    — propriété → nom du groupe qui la contient
 *   - defaults      : Map<name, object>  — valeurs par défaut par groupe
 *
 * Le fichier est résolu dans cet ordre :
 *   1. Le chemin passé en argument à load()
 *   2. process.cwd() / groups.yaml
 *   3. __dirname / groups.yaml  (répertoire du module lui-même)
 *
 * Le résultat est mis en cache après le premier chargement.
 * Appeler GroupLoader.reset() invalide le cache (utile pour les tests).
 */
class GroupLoader {
  constructor() {
    this._cache = null;
  }

  /**
   * Charge et parse le fichier de groupes.
   * @param {string} [filePath]  Chemin explicite (optionnel)
   * @returns {{ groupNames, groupSets, propToGroup, defaults }}
   */
  load(filePath) {
    if (this._cache) return this._cache;

    const resolved = this._resolve(filePath);
    if (!resolved) {
      // Aucun fichier trouvé : on retourne les groupes vides
      // (le parser / converter tombera dans le cas "rest")
      this._cache = this._empty();
      return this._cache;
    }

    const raw  = fs.readFileSync(resolved, 'utf8');
    const doc  = yaml.load(raw) ?? {};
    const defs = doc.groups ?? {};

    const groupNames  = [];
    const groupSets   = new Map();
    const propToGroup = new Map();
    const defaults    = new Map();

    for (const [groupName, groupDef] of Object.entries(defs)) {
      groupNames.push(groupName);
      const set = new Set();

      for (const entry of (groupDef.properties ?? [])) {
        // Une entrée peut être un scalaire ou un objet { prop: { description, properties } }
        // On ne prend que les feuilles scalaires.
        if (typeof entry === 'string') {
          set.add(entry);
          // Ne pas écraser : le premier groupe déclaré gagne.
          if (!propToGroup.has(entry)) propToGroup.set(entry, groupName);
        } else if (entry && typeof entry === 'object') {
          // Syntaxe étendue :  - offset:\n    properties: [top, left, …]
          // On enregistre la clé parente ET ses enfants dans le même groupe.
          const [parentKey, childDef] = Object.entries(entry)[0];
          set.add(parentKey);
          if (!propToGroup.has(parentKey)) propToGroup.set(parentKey, groupName);
          for (const child of (childDef?.properties ?? [])) {
            if (typeof child === 'string') {
              set.add(child);
              if (!propToGroup.has(child)) propToGroup.set(child, groupName);
            }
          }
        }
      }

      groupSets.set(groupName, set);
      defaults.set(groupName, groupDef.defaults ?? {});
    }

    this._cache = { groupNames, groupSets, propToGroup, defaults, filePath: resolved };
    return this._cache;
  }

  /** Invalide le cache (utile pour les tests ou le hot-reload). */
  reset() {
    this._cache = null;
    return this;
  }

  // ─── Interne ─────────────────────────────────────────────────────────────────

  /**
   * Remonte l'arborescence depuis `startDir` jusqu'à trouver un dossier
   * contenant `package.json` (= racine du projet utilisateur).
   * S'arrête à la racine du système de fichiers.
   */
  _findProjectRoot(startDir) {
    let dir = startDir;
    while (true) {
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }

  _resolve(explicit) {
    // 1. Chemin explicite passé en argument
    if (explicit) {
      const abs = path.resolve(explicit);
      if (fs.existsSync(abs)) return abs;
    }

    // 2. Racine du projet (remontée depuis __dirname jusqu'à package.json)
    //    Quand le module est dans node_modules/style-parser/lib/, on remonte
    //    jusqu'au package.json du module, puis on continue jusqu'au projet parent.
    const dirs = [];
    let dir = __dirname;
    while (true) {
      dirs.push(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    for (const d of dirs) {
      const candidate = path.join(d, 'groups.yaml');
      if (fs.existsSync(candidate)) {
        // Vérifier qu'on n'est PAS dans node_modules (on veut le fichier du projet, pas du paquet)
        if (!candidate.includes('node_modules')) return candidate;
      }
    }

    // 3. Répertoire de travail courant (process.cwd()) — le plus fiable en pratique
    const fromCwd = path.join(process.cwd(), 'groups.yaml');
    if (fs.existsSync(fromCwd)) return fromCwd;

    // 4. Fallback : même dossier que group-loader.js (dans node_modules si installé)
    const fromDir = path.join(__dirname, 'groups.yaml');
    if (fs.existsSync(fromDir)) return fromDir;

    return null;
  }

  _empty() {
    return { groupNames: [], groupSets: new Map(), propToGroup: new Map(), defaults: new Map(), filePath: null };
  }
}

// Singleton partagé dans tout le module
const loader = new GroupLoader();

module.exports = { GroupLoader, loader };
