// Tests de shared/ninja.js et de sa copie dans le script Violentmonkey.
// Usage : node tools/test-ninja.mjs   (lancé par la CI à chaque push)
import { readFileSync } from 'node:fs';
import { deepStrictEqual as eq, ok } from 'node:assert/strict';
import { PoeNinja as N, SHARED_NINJA } from './ninja.mjs';
import { buildUserscript } from './build-userscript.mjs';

const F = JSON.parse(readFileSync(new URL('./fixtures/ninja.json', import.meta.url), 'utf8'));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('exchange : clé x|id, nom, valeur, courbe ; lignes sans nom écartées ; monnaie principale', () => {
  const r = N.exchangeLines(F.exchange);
  eq(r.lines.map(l => [l.k, l.name, l.v]), [['x|divine', 'Divine Orb', 168.7], ['x|stacked-deck', 'Stacked Deck', 2.15]]);
  eq(r.lines[0].sp, [0, 1.5, 2]);
  eq(r.core, { primary: 'chaos', rates: { divine: 0.0059 } });
  eq(r.icons[0], ['Divine Orb', '/gen/image/divine.png']);
});
test('currency : clé c|detailsId et équivalents chaos par id du site de trade', () => {
  const r = N.currencyLines(F.currency);
  eq(r.lines.map(l => [l.k, l.name, l.v]), [['c|chaos-orb', 'Chaos Orb', 1], ['c|mirror-shard', 'Mirror Shard', 3500]]);
  eq(r.tradeIds, { chaos: 1, 'mirror-shard': 3500 });
});
test('uniques : clé i|type|detailsId|liens, plages des mods, courbe de secours', () => {
  const [hh, tab] = N.itemLines('UniqueAccessory', F.uniques).lines;
  eq(hh.k, 'i|UniqueAccessory|headhunter|0');
  eq(hh.ranges, ['+(40-55) to maximum Life']);
  eq(hh.iranges, ['+(25-40) to maximum Life']);
  eq(hh.sp, [0, 4], 'courbe « faible confiance » quand la principale est vide');
  eq([tab.k, tab.links], ['i|UniqueAccessory|tabula-rasa-6l|6', 6]);
});
test('gemmes : niveau, qualité, corruption par défaut', () => {
  const [a, b] = N.itemLines('SkillGem', F.gems).lines;
  eq([a.gemLevel, a.gemQuality, a.corrupted], [1, 0, false]);
  eq([b.gemLevel, b.gemQuality, b.corrupted, b.v], [1, 20, true, 168]);
  ok(!('ranges' in a), 'pas de plages hors uniques');
});
test('bases : ilvl et type gardés, lignes sous 5 c écartées', () => {
  const lines = N.itemLines('BaseType', F.bases).lines;
  eq(lines.map(l => [l.name, l.variant, l.ilvl, l.itemType]), [['Velour Boots', 'Redeemer/Hunter', 85, 'Boots']]);
});
test('catégories : les annexes sont dans ITEM_TYPES et marquées à part', () => {
  for (const t of N.EXTRA_TYPES) ok(N.ITEM_TYPES.includes(t), t);
  ok(N.EXCHANGE_TYPES.includes('Currency') && N.STASH_CURRENCY_TYPES.includes('Currency'));
});
test('ligue : nom exact, nom GGG plus long, même mode, jamais au hasard', () => {
  const id = g => (N.pickLeague(F.leagues, g) || {}).id || null;
  eq(id('Covens'), 'Covens');
  eq(id('covens of umbra'), 'Covens');
  eq(id('Hardcore Covens'), 'Hardcore Covens');
  eq(id('Hardcore Covens of Umbra'), 'Hardcore Covens');
  eq(id(''), null, 'ligue vide : rien (avant le 18/11 : Hardcore Covens par erreur)');
  eq(id('Settlers'), null);
});
test('script Violentmonkey : copie de shared/ninja.js à jour', () => {
  const script = readFileSync(new URL('../poe-stash-scanner.user.js', import.meta.url), 'utf8');
  eq(buildUserscript(script, readFileSync(SHARED_NINJA, 'utf8')), script, 'lancer `node tools/build-userscript.mjs`');
});
test('script Violentmonkey : la copie donne les mêmes lignes que Node', () => {
  const script = readFileSync(new URL('../poe-stash-scanner.user.js', import.meta.url), 'utf8');
  const block = script.slice(script.indexOf('// @@ninja-begin'), script.indexOf('// @@ninja-end'));
  const S = new Function(`${block}\nreturn PoeNinja;`)();
  eq(S.exchangeLines(F.exchange), N.exchangeLines(F.exchange));
  eq(S.currencyLines(F.currency), N.currencyLines(F.currency));
  eq(S.itemLines('UniqueAccessory', F.uniques), N.itemLines('UniqueAccessory', F.uniques));
});

let fail = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`ÉCHEC ${name}\n     ${e.message.split('\n')[0]}`); }
}
console.log(`${tests.length - fail}/${tests.length} tests réussis`);
process.exit(fail ? 1 : 0);
