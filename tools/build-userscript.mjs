// Copie shared/ninja.js dans le script Violentmonkey, entre les marqueurs @@ninja-begin / @@ninja-end.
// Usage : node tools/build-userscript.mjs          met à jour le script
//         node tools/build-userscript.mjs --check  échoue si la copie n'est pas à jour (CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SHARED_NINJA } from './ninja.mjs';

const SCRIPT = fileURLToPath(new URL('../poe-stash-scanner.user.js', import.meta.url));
const BEGIN = /^( *)\/\/ @@ninja-begin[^\n]*\n/m, END = /^ *\/\/ @@ninja-end[^\n]*$/m;

export function buildUserscript(script, shared) {
  const b = script.match(BEGIN), e = script.match(END);
  if (!b || !e || e.index < b.index) throw new Error('marqueurs @@ninja-begin / @@ninja-end introuvables dans le script');
  const indent = b[1];
  const body = shared.trimEnd().split('\n').map(l => (l ? indent + l : l)).join('\n') + '\n';
  return script.slice(0, b.index + b[0].length) + body + script.slice(e.index);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const script = readFileSync(SCRIPT, 'utf8');
  const next = buildUserscript(script, readFileSync(SHARED_NINJA, 'utf8'));
  if (process.argv.includes('--check')) {
    if (next !== script) { console.error('poe-stash-scanner.user.js : la copie de shared/ninja.js n\'est pas à jour. Lance `node tools/build-userscript.mjs`.'); process.exit(1); }
    console.log('Script à jour avec shared/ninja.js');
  } else {
    writeFileSync(SCRIPT, next);
    console.log(next === script ? 'Script déjà à jour' : 'Script mis à jour depuis shared/ninja.js');
  }
}
