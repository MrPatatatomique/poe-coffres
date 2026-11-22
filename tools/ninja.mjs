// Charge shared/ninja.js (source unique des transformations poe.ninja, aussi copiée dans le script Violentmonkey).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const SHARED_NINJA = fileURLToPath(new URL('../shared/ninja.js', import.meta.url));
export const PoeNinja = new Function(`${readFileSync(SHARED_NINJA, 'utf8')}\nreturn PoeNinja;`)();
