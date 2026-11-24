// Tests des données PoE2 : transformations poe.ninja (tools/ninja2.mjs) et passage complet de récupération.
// Usage : node tools/test-poe2.mjs   (lancé par la CI à chaque push)
import { readFileSync } from 'node:fs';
import { deepStrictEqual as eq, ok } from 'node:assert/strict';
import { exchangeLines, itemLines, sig, EXCHANGE_TYPES, ITEM_TYPES } from './ninja2.mjs';
import { fetchLeague2, historySnapshot } from './update-poe2.mjs';

const F = JSON.parse(readFileSync(new URL('./fixtures/ninja2.json', import.meta.url), 'utf8'));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('exchange : clé x|id, valeur en divines (4 chiffres), monnaie principale et taux', () => {
  const r = exchangeLines(F.exchange.Currency);
  const byK = Object.fromEntries(r.lines.map(l => [l.k, l]));
  eq([byK['x|divine'].name, byK['x|divine'].v], ['Divine Orb', 1]);
  eq(byK['x|exalted'].v, 0.00212);
  eq(byK['x|wisdom'].v, 0.0000258);
  eq(r.core.primary, 'divine');
  eq(r.core.rates.exalted, 471.8);
  ok(r.icons.some(([n, u]) => n === 'Exalted Orb' && u.startsWith('/gen/image/')));
});
test('exchange sans « core » (catégories autres que Currency) : lignes quand même', () => {
  const r = exchangeLines(F.exchange.Essences);
  eq(r.lines.map(l => l.k), ['x|essence-of-battle', 'x|essence-of-delirium']);
  eq(r.core, null);
});
test('uniques : clé u|detailsId, variante corrompue à part, doublon le moins coté écarté', () => {
  const r = itemLines('UniqueAccessories', F.items.UniqueAccessories);
  const mb = r.lines.filter(l => l.name === 'Mageblood');
  eq(mb.map(l => [l.k, l.v, l.n]), [['u|mageblood-utility-belt', 125, 6558], ['u|mageblood-utility-belt|c', 150, 12]]);
  eq([mb[0].base, mb[0].cat], ['Utility Belt', 'Belt']);
  ok(r.icons[0][1].startsWith('/gen/image/'), 'icône relative à web.poecdn.com');
});
test('tablettes : une ligne par rareté (detailsId), icône par base', () => {
  const r = itemLines('PrecursorTablets', F.items.PrecursorTablets);
  eq(r.lines.map(l => l.k), ['u|abyss-tablet-abyss-tablet-rare', 'u|temple-tablet-temple-tablet-rare', 'u|temple-tablet-temple-tablet-magic', 'u|irradiated-tablet-irradiated-tablet-normal']);
  eq(r.icons[0][0], 'Abyss Tablet');
});
test('sig : 4 chiffres significatifs', () => {
  eq([sig(0.0021234), sig(1234.56), sig(0)], [0.002123, 1235, 0]);
});
test('passage complet : catégories en échec reprises du passage précédent, exclues de l\'historique', async () => {
  const url2fx = u => {
    const t = new URL(u).searchParams.get('type');
    if (u.includes('/exchange/')) return F.exchange[t] || null;
    return F.items[t] || null;
  };
  const prev = { exchange: { Runes: [{ k: 'x|old-rune', name: 'Old Rune', v: 3 }] }, items: {}, core: null };
  const p = await fetchLeague2('Test', prev, async u => url2fx(u));
  eq(Object.keys(p.exchange).sort(), ['Currency', 'Essences', 'Runes', 'UncutGems']);
  eq(p.stale, ['exchange|Runes']);
  eq(p.core.primary, 'divine');
  const snap = historySnapshot(p);
  ok(snap.has('x|exalted') && !snap.has('x|old-rune'), 'catégorie reprise hors historique');
  ok(!snap.has('u|the-gnashing-sash-heavy-belt') || snap.get('u|the-gnashing-sash-heavy-belt') > 0);
  ok(p.icons['Divine Orb'], 'icônes collectées');
  eq(EXCHANGE_TYPES.length + ITEM_TYPES.length, 23);
});

let fail = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (e) { fail++; console.log(`ÉCHEC ${name}\n     ${e.message}`); }
}
process.exit(fail ? 1 : 0);
