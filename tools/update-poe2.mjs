// Données PoE2 de Coffres : prix poe.ninja, icônes, historique et mods du site de trade PoE2.
// Appelé par tools/update-data.mjs (dossier <data>/poe2). poe.ninja ne met à jour PoE2 qu'environ toutes les heures :
// une ligue récupérée il y a moins de 50 min est laissée telle quelle.
//
// poe2/leagues.json            { at, leagues: [{ id, name, file }] }
// poe2/prices/<ligue>.json     { league, fetchedAt, core, exchange: { type: lignes }, items: { type: lignes }, stale }
// poe2/icons/<ligue>.json      { nom: chemin relatif à web.poecdn.com }
// poe2/history/<ligue>/<n>.json et poe2/history-recent/… : même format que PoE1, valeurs en monnaie principale
// poe2/trade-stats.json        { at, map: { "type|texte": id }, ids: { id: texte } } (une fois par jour)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getJson, slug, writeHistory } from './update-data.mjs';
import { EXCHANGE_TYPES, ITEM_TYPES, exchangeLines, itemLines } from './ninja2.mjs';

const NINJA2 = 'https://poe.ninja/poe2/api/economy';
const REFRESH = 50 * 60000;
const MIN_ITEM_LISTINGS = 2; // un unique coté sur une seule annonce n'entre pas dans l'historique (prix fantaisistes)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = async f => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };

export async function fetchLeague2(league, prev = null, get = getJson) {
  const q = t => `?league=${encodeURIComponent(league)}&type=${t}`;
  const out = { league, fetchedAt: Date.now(), core: null, exchange: {}, items: {}, stale: [] };
  const icons = {};
  Object.defineProperty(out, 'icons', { value: icons, enumerable: false });
  const addIcons = list => { for (const [n, u] of list) if (n && u && !icons[n]) icons[n] = u; };
  const fallback = (sec, t) => {
    const old = prev && prev[sec] && prev[sec][t];
    if (old && old.length) { out[sec][t] = old; out.stale.push(`${sec}|${t}`); console.warn(`PoE2 ${league} : ${sec}/${t} indisponible, anciennes valeurs conservées`); }
  };
  for (const t of EXCHANGE_TYPES) {
    const j = await get(`${NINJA2}/exchange/current/overview${q(t)}`);
    if (j) {
      const r = exchangeLines(j);
      addIcons(r.icons);
      out.exchange[t] = r.lines;
      if (r.core && !out.core) out.core = r.core;
    }
    if (!out.exchange[t] || !out.exchange[t].length) fallback('exchange', t);
    await sleep(250);
  }
  for (const t of ITEM_TYPES) {
    const j = await get(`${NINJA2}/stash/current/item/overview${q(t)}`);
    if (j) {
      const r = itemLines(t, j);
      addIcons(r.icons);
      out.items[t] = r.lines;
    }
    if (!out.items[t] || !out.items[t].length) fallback('items', t);
    await sleep(250);
  }
  if (!out.core && prev && prev.core) out.core = prev.core;
  return out;
}

export function historySnapshot(p) {
  const snap = new Map();
  const stale = new Set(p.stale || []);
  for (const [t, lines] of Object.entries(p.exchange)) if (!stale.has(`exchange|${t}`)) for (const l of lines) if (l.v > 0) snap.set(l.k, l.v);
  for (const [t, lines] of Object.entries(p.items)) if (!stale.has(`items|${t}`)) for (const l of lines) if (l.v > 0 && l.n >= MIN_ITEM_LISTINGS) snap.set(l.k, l.v);
  return snap;
}

async function updateTradeStats2(dir) {
  const file = join(dir, 'trade-stats.json');
  const old = await readJson(file);
  if (old && Date.now() - old.at < 20 * 3600000) return Object.keys(old.map).length;
  const j = await getJson('https://www.pathofexile.com/api/trade2/data/stats');
  if (!j || !j.result) { console.warn('PoE2 : stats du trade indisponibles'); return old ? Object.keys(old.map).length : 0; }
  const map = {}, ids = {};
  for (const g of j.result) for (const e of g.entries || []) {
    ids[e.id] = e.text;
    if (e.option) continue;
    const k = `${e.type}|${e.text}`;
    if (!map[k]) map[k] = e.id;
  }
  await writeFile(file, JSON.stringify({ at: Date.now(), map, ids }));
  return Object.keys(map).length;
}

export async function updatePoe2(dir) {
  await mkdir(join(dir, 'prices'), { recursive: true });
  const leagues = await getJson(`${NINJA2}/leagues`);
  if (!leagues || !leagues.length) throw new Error('liste des ligues poe.ninja PoE2 indisponible');
  for (const lg of leagues) {
    const t0 = Date.now();
    const file = join(dir, 'prices', `${slug(lg.id)}.json`);
    const prev = existsSync(file) ? await readJson(file) : null;
    if (prev && Date.now() - prev.fetchedAt < REFRESH) { console.log(`PoE2 ${lg.id} : prix de moins de 50 min, inchangés`); continue; }
    const p = await fetchLeague2(lg.id, prev);
    const stale = new Set(p.stale);
    const fresh = [...Object.entries(p.exchange).map(([t, l]) => [`exchange|${t}`, l]), ...Object.entries(p.items).map(([t, l]) => [`items|${t}`, l])]
      .filter(([k]) => !stale.has(k)).reduce((a, [, l]) => a + l.length, 0);
    if (fresh < 30) { console.warn(`PoE2 ${lg.id} : trop peu de lignes fraîches (${fresh}), prix laissés tels quels`); continue; }
    await writeFile(file, JSON.stringify(p));
    const iconsFile = join(dir, 'icons', `${slug(lg.id)}.json`);
    await mkdir(join(dir, 'icons'), { recursive: true });
    await writeFile(iconsFile, JSON.stringify({ ...((await readJson(iconsFile)) || {}), ...p.icons }));
    const st = await writeHistory(join(dir, 'history', slug(lg.id)), historySnapshot(p), Math.floor(p.fetchedAt / 60000), join(dir, 'history-recent', slug(lg.id)));
    console.log(`PoE2 ${lg.id} : ${fresh} lignes${p.stale.length ? ` (${p.stale.length} catégories reprises)` : ''}, historique ${st.series} séries / ${st.points} points, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  // une ligue absente de poe.ninja garde ses fichiers : la page la propose encore tant qu'ils existent
  await writeFile(join(dir, 'leagues.json'), JSON.stringify({ at: Date.now(), leagues: leagues.map(l => ({ id: l.id, name: l.name, file: slug(l.id) })) }));
  console.log(`PoE2 mods du trade : ${await updateTradeStats2(dir)}`);
}
