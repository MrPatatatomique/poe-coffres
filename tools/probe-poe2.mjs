// Sonde temporaire : échantillons poe.ninja PoE2 et trade2 (supprimée après usage)
import { writeFile, mkdir } from 'node:fs/promises';
const UA = 'poe-coffres/1.0 (+https://github.com/MrPatatatomique/poe-coffres)';
const get = async u => { try { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); const t = await r.text(); console.log(r.status, u, t.length); try { return JSON.parse(t); } catch { return { _html: t.slice(0, 200) }; } } catch (e) { console.log('ERR', u, e.message); return null; } };
await mkdir('probe', { recursive: true });
const N = 'https://poe.ninja/poe2/api/economy';
const leagues = await get(`${N}/leagues`);
await writeFile('probe/leagues.json', JSON.stringify(leagues, null, 1));
const lg = leagues?.[0]?.id;
const ex = ['Currency','Fragments','Abyss','UncutGems','LineageSupportGems','Essences','SoulCores','Idols','Runes','Ritual','Expedition','Delirium','Breach','Verisium'];
const it = ['UniqueWeapons','UniqueArmours','UniqueAccessories','UniqueFlasks','UniqueCharms','UniqueJewels','UniqueSanctumRelics','UniqueTablets','PrecursorTablets'];
const sum = {};
for (const t of ex) { const j = await get(`${N}/exchange/current/overview?league=${encodeURIComponent(lg)}&type=${t}`); sum['x|'+t] = j?.lines?.length; if (t==='Currency'||t==='UncutGems') await writeFile(`probe/x-${t}.json`, JSON.stringify(j, null, 1)); else await writeFile(`probe/x-${t}.json`, JSON.stringify({ core: j?.core && { primary: j.core.primary, secondary: j.core.secondary }, lines: j?.lines?.slice(0, 3), items: j?.items?.slice?.(0,3) }, null, 1)); }
for (const t of it) { const j = await get(`${N}/stash/current/item/overview?league=${encodeURIComponent(lg)}&type=${t}`); sum['i|'+t] = j?.lines?.length; await writeFile(`probe/i-${t}.json`, JSON.stringify({ keys: j && Object.keys(j), lines: j?.lines?.slice(0, 4) }, null, 1)); }
console.log(JSON.stringify(sum));
const P = 'https://www.pathofexile.com/api/trade2';
const st = await get(`${P}/data/static`); await writeFile('probe/trade2-static.json', JSON.stringify(st).slice(0, 20000));
const lgs = await get(`${P}/data/leagues`); await writeFile('probe/trade2-leagues.json', JSON.stringify(lgs, null, 1));
const items = await get(`${P}/data/items`); await writeFile('probe/trade2-items.json', JSON.stringify(items).slice(0, 5000));
const stats = await get(`${P}/data/stats`); await writeFile('probe/trade2-stats.json', JSON.stringify(stats).slice(0, 3000));
const gl = await get('https://api.pathofexile.com/league?realm=poe2'); await writeFile('probe/ggg-leagues.json', JSON.stringify(gl, null, 1));
