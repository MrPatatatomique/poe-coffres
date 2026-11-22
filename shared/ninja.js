// Transformation des réponses poe.ninja en lignes de prix Coffres PoE1.
// Source unique, utilisée par tools/update-data.mjs (Node) et par le script Violentmonkey.
// Le script en contient une copie entre les marqueurs @@ninja-begin / @@ninja-end :
// après une modification ici, lancer `node tools/build-userscript.mjs` (la CI vérifie que la copie est à jour).
// Pas d'import ni d'export : ce fichier doit rester du JavaScript « script » pur.
const PoeNinja = (() => {
  const EXCHANGE_TYPES = ['Currency', 'Fragment', 'Runegraft', 'AllflameEmber', 'Tattoo', 'Omen', 'DjinnCoin', 'Ducat', 'EnshroudingCrystal', 'DivinationCard', 'Artifact', 'Oil', 'DeliriumOrb', 'Scarab', 'Astrolabe', 'Thread', 'Fossil', 'Resonator', 'Essence'];
  const STASH_CURRENCY_TYPES = ['Currency', 'Fragment'];
  // catégories cotées par ligne exacte (ilvl, influences, enchantement…) : publiées à part par le dépôt, jamais récupérées par le script
  const EXTRA_TYPES = ['BaseType', 'ImbuedGem', 'ClusterJewel', 'ForbiddenJewel', 'Flask', 'ScryingOrb', 'IncursionTemple', 'Beast', 'ShrineBelt'];
  const ITEM_TYPES = ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel', 'UniqueTincture', 'UniqueRelic', 'UniqueMap', 'SkillGem', 'Map', 'BlightedMap', 'BlightRavagedMap', 'ValdoMap', 'Invitation', 'Memory', 'Incubator', 'Vial', 'Wombgift', 'Corpse', 'Viscera', ...EXTRA_TYPES];
  // Base Types : ~16 000 lignes, on ne garde que celles qui valent au moins 5 c
  const MIN_CHAOS = { BaseType: 5 };
  const RANGE = /\(-?[\d.]+-/;

  // /exchange/current/overview → lignes { k: x|id, name, v (en monnaie principale : voir core), sp }
  function exchangeLines(j) {
    const names = new Map((j.items || []).map(i => [i.id, i.name]));
    return {
      lines: (j.lines || []).map(l => ({ k: `x|${l.id}`, name: names.get(l.id), v: l.primaryValue, sp: l.sparkline?.data })).filter(l => l.name),
      core: j.core ? { primary: j.core.primary, rates: j.core.rates } : null,
      icons: (j.items || []).map(i => [i.name, i.image]),
    };
  }
  // /stash/current/currency/overview → lignes { k: c|detailsId, name, v (chaos), sp } + équivalents chaos par id du site de trade
  function currencyLines(j) {
    const tid = new Map((j.currencyDetails || []).map(d => [d.name, d.tradeId]));
    const tradeIds = {};
    for (const l of j.lines || []) { const t2 = tid.get(l.currencyTypeName); if (t2 && l.chaosEquivalent > 0) tradeIds[t2] = l.chaosEquivalent; }
    return {
      lines: (j.lines || []).map(l => ({ k: `c|${l.detailsId}`, name: l.currencyTypeName, v: l.chaosEquivalent, sp: l.receiveSparkLine?.data })),
      tradeIds,
      icons: (j.currencyDetails || []).map(d => [d.name, d.icon]),
    };
  }
  // /stash/current/item/overview → lignes { k: i|type|detailsId|liens, name, baseType, variant, … v (chaos) }
  function itemLines(t, j) {
    return {
      lines: (j.lines || []).filter(l => !(l.chaosValue < (MIN_CHAOS[t] || 0))).map(l => ({
        k: `i|${t}|${l.detailsId}|${l.links || 0}`,
        name: l.name, baseType: l.baseType, variant: l.variant, links: l.links || 0,
        gemLevel: l.gemLevel, gemQuality: l.gemQuality || 0, corrupted: !!l.corrupted,
        mapTier: l.mapTier, itemClass: l.itemClass, v: l.chaosValue, listings: l.listingCount,
        ...(l.levelRequired ? { ilvl: l.levelRequired } : {}), ...(l.itemType ? { itemType: l.itemType } : {}),
        sp: (l.sparkLine?.data || []).some(x => x !== null) ? l.sparkLine.data : l.lowConfidenceSparkLine?.data,
        ...(/^Unique/.test(t) ? {
          ranges: (l.explicitModifiers || []).map(m => m.text).filter(x => RANGE.test(x)),
          iranges: (l.implicitModifiers || []).map(m => m.text).filter(x => RANGE.test(x)),
        } : {}),
      })),
      icons: (j.lines || []).map(l => [l.name, l.icon]),
    };
  }
  // Ligue poe.ninja correspondant à une ligue GGG : nom exact, sinon ligue GGG plus longue que l'id poe.ninja
  // (« Covens of Umbra » → « Covens ») dans le même mode (softcore / hardcore). Jamais une ligue au hasard : null.
  function pickLeague(leagues, gggLeague) {
    const g = String(gggLeague || '').trim().toLowerCase();
    if (!g) return null;
    const exact = leagues.find(l => l.id.toLowerCase() === g || String(l.name || '').toLowerCase() === g);
    if (exact) return exact;
    const hc = /hardcore|\bhc\b/.test(g);
    return leagues.filter(l => g.startsWith(l.id.toLowerCase()) && /hardcore/i.test(l.id) === hc).sort((a, b) => b.id.length - a.id.length)[0] || null;
  }
  return { EXCHANGE_TYPES, STASH_CURRENCY_TYPES, EXTRA_TYPES, ITEM_TYPES, MIN_CHAOS, exchangeLines, currencyLines, itemLines, pickLeague };
})();
