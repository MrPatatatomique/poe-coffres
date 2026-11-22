// Vérifie que docs/protocole.md documente chaque commande, message et clé de stockage utilisés dans le code.
// Usage : node tools/test-protocol.mjs   (lancé par la CI à chaque push)
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const page = read('coffres-poe1.html'), script = read('poe-stash-scanner.user.js'), doc = read('docs/protocole.md');
const all = (re, s) => new Set([...s.matchAll(re)].map(m => m[1]));

const groups = {
  'commandes envoyées par la page': all(/cmd\('([a-z-]+)'/g, page),
  'commandes traitées par le script': all(/m\.cmd === '([a-z-]+)'/g, script),
  'messages envoyés par le script': all(/send\('([a-z-]+)'/g, script),
  'messages traités par la page': all(/case '([a-z-]+)':/g, page.slice(page.indexOf("addEventListener('message'"))),
  'clés du stockage du script': all(/GM_(?:get|set)Value\('([A-Za-z]+)'/g, script),
  'clés du stockage de la page': all(/store\.(?:get|set)\('(poe[A-Za-z]+)'/g, page),
};
let fail = 0;
for (const [name, set] of Object.entries(groups)) {
  const missing = [...set].filter(x => !doc.includes(`\`${x}\``));
  if (missing.length) { fail++; console.log(`ÉCHEC ${name} non documentés dans docs/protocole.md : ${missing.join(', ')}`); }
  else console.log(`ok   ${name} (${set.size})`);
}
// une commande envoyée doit être traitée, un message envoyé doit être lu
const unhandled = [...groups['commandes envoyées par la page']].filter(c => !groups['commandes traitées par le script'].has(c));
const unread = [...groups['messages envoyés par le script']].filter(c => !groups['messages traités par la page'].has(c));
if (unhandled.length) { fail++; console.log(`ÉCHEC commandes sans traitement dans le script : ${unhandled.join(', ')}`); } else console.log('ok   chaque commande de la page est traitée par le script');
if (unread.length) { fail++; console.log(`ÉCHEC messages ignorés par la page : ${unread.join(', ')}`); } else console.log('ok   chaque message du script est lu par la page');
process.exit(fail ? 1 : 0);
