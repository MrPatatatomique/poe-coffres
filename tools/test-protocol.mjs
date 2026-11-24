// Vérifie que docs/protocole.md documente chaque commande, message et clé de stockage utilisés dans le code.
// Usage : node tools/test-protocol.mjs   (lancé par la CI à chaque push)
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const page1 = read('coffres-poe1.html'), page2 = read('coffres-poe2.html'), script = read('poe-stash-scanner.user.js'), doc = read('docs/protocole.md');
const all = (re, s) => new Set([...s.matchAll(re)].map(m => m[1]));

const handled = p => p.slice(p.indexOf("addEventListener('message'"));
const union = (...sets) => new Set(sets.flatMap(x => [...x]));
const groups = {
  'commandes envoyées par les pages': union(all(/cmd\('([a-z0-9-]+)'/g, page1), all(/cmd\('([a-z0-9-]+)'/g, page2)),
  'commandes traitées par le script': all(/m\.cmd === '([a-z0-9-]+)'/g, script),
  'messages envoyés par le script': all(/send\('([a-z0-9-]+)'/g, script),
  'messages traités par les pages': union(all(/case '([a-z0-9-]+)':/g, handled(page1)), all(/case '([a-z0-9-]+)':/g, handled(page2))),
  'clés du stockage du script': all(/GM_(?:get|set)Value\('([A-Za-z0-9]+)'/g, script),
  'clés du stockage des pages': union(all(/store\.(?:get|set)\('(poe[A-Za-z0-9]+)'/g, page1), all(/store\.(?:get|set)\('(poe[A-Za-z0-9]+)'/g, page2)),
};
let fail = 0;
for (const [name, set] of Object.entries(groups)) {
  const missing = [...set].filter(x => !doc.includes(`\`${x}\``));
  if (missing.length) { fail++; console.log(`ÉCHEC ${name} non documentés dans docs/protocole.md : ${missing.join(', ')}`); }
  else console.log(`ok   ${name} (${set.size})`);
}
// une commande envoyée doit être traitée, un message envoyé doit être lu
const unhandled = [...groups['commandes envoyées par les pages']].filter(c => !groups['commandes traitées par le script'].has(c));
const unread = [...groups['messages envoyés par le script']].filter(c => !groups['messages traités par les pages'].has(c));
if (unhandled.length) { fail++; console.log(`ÉCHEC commandes sans traitement dans le script : ${unhandled.join(', ')}`); } else console.log('ok   chaque commande des pages est traitée par le script');
if (unread.length) { fail++; console.log(`ÉCHEC messages ignorés par la page : ${unread.join(', ')}`); } else console.log('ok   chaque message du script est lu par une page');
process.exit(fail ? 1 : 0);
