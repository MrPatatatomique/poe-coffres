// Transformation des réponses poe.ninja PoE2 en lignes de prix Coffres PoE2.
// Toutes les valeurs sont dans la monnaie principale de la ligue (core.primary, le Divine Orb aujourd'hui).
// Différences avec PoE1 : pas d'endpoint de monnaies « stash », une seule valeur par ligne (primaryValue),
// pas de liens ni de niveaux de gemme, mises à jour poe.ninja environ toutes les heures.

export const EXCHANGE_TYPES = ['Currency', 'Fragments', 'Abyss', 'UncutGems', 'LineageSupportGems', 'Essences', 'SoulCores', 'Idols', 'Runes', 'Ritual', 'Expedition', 'Delirium', 'Breach', 'Verisium'];
export const ITEM_TYPES = ['UniqueWeapons', 'UniqueArmours', 'UniqueAccessories', 'UniqueFlasks', 'UniqueCharms', 'UniqueJewels', 'UniqueSanctumRelics', 'UniqueTablets', 'PrecursorTablets'];

// 4 chiffres significatifs : les monnaies courantes valent quelques millièmes de divine
export const sig = v => (v > 0 ? Number(v.toPrecision(4)) : 0);
const relIcon = u => (u ? String(u).replace(/^https:\/\/web\.poecdn\.com/, '') : '');
const cleanCat = c => String(c || '').replace(/^\[|\]$/g, '').split('|').pop();

// /exchange/current/overview → { lines: [{ k: x|id, name, v, vol, sp }], core: { primary, secondary, rates }, icons: [[nom, chemin]] }
export function exchangeLines(j) {
  const meta = new Map((j.items || []).map(i => [i.id, i]));
  const lines = [];
  for (const l of j.lines || []) {
    const m = meta.get(l.id);
    if (!m || !(l.primaryValue > 0)) continue;
    lines.push({ k: `x|${l.id}`, name: m.name, v: sig(l.primaryValue), vol: sig(l.volumePrimaryValue || 0), sp: l.sparkline?.data });
  }
  const c = j.core;
  return {
    lines,
    core: c ? { primary: c.primary, secondary: c.secondary, rates: c.rates || {} } : null,
    icons: [...(j.items || []), ...((c && c.items) || [])].map(i => [i.name, relIcon(i.image)]),
  };
}

// /stash/current/item/overview → { lines: [{ k: u|detailsId[|variante][|c], name, base, cat, var, cr, lvl, n, v, sp }], icons }
// Une même clé peut revenir (annonces regroupées autrement) : on garde la ligne qui a le plus d'annonces.
export function itemLines(t, j) {
  const byKey = new Map();
  const icons = [];
  for (const l of j.lines || []) {
    if (!(l.primaryValue > 0) || !l.detailsId) continue;
    const k = `u|${l.detailsId}${l.corrupted ? '|c' : ''}`; // detailsId contient déjà la base et la variante
    const line = { k, name: l.name, base: l.baseType || '', cat: cleanCat(l.category), var: l.variant || undefined, cr: l.corrupted ? 1 : undefined, lvl: l.levelRequired || undefined, n: l.listingCount || 0, v: sig(l.primaryValue), sp: l.sparkLine?.data };
    const old = byKey.get(k);
    if (!old || line.n > old.n) byKey.set(k, line);
    if (l.icon) icons.push([t === 'PrecursorTablets' ? l.baseType : l.name, relIcon(l.icon)]);
  }
  return { lines: [...byKey.values()], icons };
}
