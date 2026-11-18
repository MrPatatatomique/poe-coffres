// Met à jour les données partagées de Coffres PoE1 : prix poe.ninja, historique et base des uniques.
// Usage : node tools/update-data.mjs <dossier-data>
// Lancé par GitHub Actions toutes les 30 min ; le dossier est la branche « data » (un seul commit, réécrit à chaque passage).
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || 'data';
const NINJA = 'https://poe.ninja/poe1/api/economy';
const UA = 'poe-coffres/1.0 (+https://github.com/MrPatatatomique/poe-coffres)';
const POB = 'https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding/dev/src/Data/Uniques';
const POB_FILES = ['amulet', 'axe', 'belt', 'body', 'boots', 'bow', 'claw', 'dagger', 'fishing', 'flask', 'gloves', 'graft', 'helmet', 'jewel', 'mace', 'quiver', 'ring', 'shield', 'staff', 'sword', 'tincture', 'wand', 'Special/New'];

export const EXCHANGE_TYPES = ['Currency', 'Fragment', 'Runegraft', 'AllflameEmber', 'Tattoo', 'Omen', 'DjinnCoin', 'Ducat', 'EnshroudingCrystal', 'DivinationCard', 'Artifact', 'Oil', 'DeliriumOrb', 'Scarab', 'Astrolabe', 'Thread', 'Fossil', 'Resonator', 'Essence'];
export const STASH_CURRENCY_TYPES = ['Currency', 'Fragment'];
export const ITEM_TYPES = ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel', 'UniqueTincture', 'UniqueRelic', 'UniqueMap', 'SkillGem', 'Map', 'BlightedMap', 'BlightRavagedMap', 'ValdoMap', 'Invitation', 'Memory', 'Incubator', 'Vial', 'Wombgift', 'Corpse', 'Viscera',
  // ajoutées le 18/11 : cotation par ligne exacte (ilvl, influences, enchantement…), pas encore appliquée aux objets du coffre
  'BaseType', 'ImbuedGem', 'ClusterJewel', 'ForbiddenJewel', 'Flask', 'ScryingOrb', 'IncursionTemple', 'Beast', 'ShrineBelt'];
// Base Types : ~16 000 lignes, on ne garde que celles qui valent au moins 5 c
const MIN_CHAOS = { BaseType: 5 };
// Catégories publiées à part (prices-extra/<ligue>.json, chargé par la page seulement quand il sert) :
// elles doublaient la taille du fichier de prix principal.
export const EXTRA_TYPES = ['BaseType', 'ImbuedGem', 'ClusterJewel', 'ForbiddenJewel', 'Flask', 'ScryingOrb', 'IncursionTemple', 'Beast', 'ShrineBelt'];

// Historique : 30 min sur 7 jours, puis 2 h jusqu'à 30 jours, puis 6 h jusqu'à la fin de la ligue
const TIERS = [[7 * 1440, 30], [30 * 1440, 120], [Infinity, 360]];
export const SHARDS = 64;
const MIN_HISTORY_CHAOS = 1; // on n'historise pas ce qui vaut moins de 1 chaos (sauf currency et fragments)

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const slug = s => String(s).replace(/[^\w-]+/g, '_');
export function shardOf(key) { let h = 5381; for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0; return h % SHARDS; }
const round = v => v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;

async function getJson(url, tries = 3) {
  for (let k = 0; k < tries; k++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
      console.warn(`HTTP ${r.status} ${url}`);
    } catch (e) { console.warn(`${e.message} ${url}`); }
    await sleep(2000 * (k + 1));
  }
  return null;
}

// ---------------------------------------------------------------- prix
// prev : prix du passage précédent. Une catégorie en échec (ou vide) reprend ses anciennes lignes et
// est listée dans out.stale : elle reste cotée sur la page mais n'ajoute pas de point d'historique.
async function fetchLeague(league, prev = null) {
  const q = t => `?league=${encodeURIComponent(league)}&type=${t}`;
  const out = { league, fetchedAt: Date.now(), exchange: {}, currency: {}, items: {}, core: null, tradeIds: {}, stale: [] };
  // icônes par nom d'objet, publiées à part (icons/<ligue>.json) : chemin relatif à web.poecdn.com
  const icons = {};
  const icon = (name, url) => { if (name && url && !icons[name]) icons[name] = String(url).replace(/^https:\/\/web\.poecdn\.com/, ''); };
  Object.defineProperty(out, 'icons', { value: icons, enumerable: false });
  const fallback = (sec, t) => {
    const old = prev && prev[sec] && prev[sec][t];
    if (old && old.length) { out[sec][t] = old; out.stale.push(`${sec}|${t}`); console.warn(`${league} : ${sec}/${t} indisponible, anciennes valeurs conservées`); }
  };
  for (const t of EXCHANGE_TYPES) {
    const j = await getJson(`${NINJA}/exchange/current/overview${q(t)}`);
    if (j) {
      const names = new Map((j.items || []).map(i => [i.id, i.name]));
      for (const i of j.items || []) icon(i.name, i.image);
      out.exchange[t] = (j.lines || []).map(l => ({ k: `x|${l.id}`, name: names.get(l.id), v: l.primaryValue, sp: l.sparkline?.data })).filter(l => l.name);
      if (t === 'Currency' && j.core) out.core = { primary: j.core.primary, rates: j.core.rates };
    }
    if (!out.exchange[t] || !out.exchange[t].length) fallback('exchange', t);
    await sleep(250);
  }
  for (const t of STASH_CURRENCY_TYPES) {
    const j = await getJson(`${NINJA}/stash/current/currency/overview${q(t)}`);
    if (j) {
      out.currency[t] = (j.lines || []).map(l => ({ k: `c|${l.detailsId}`, name: l.currencyTypeName, v: l.chaosEquivalent, sp: l.receiveSparkLine?.data }));
      const tid = new Map((j.currencyDetails || []).map(d => [d.name, d.tradeId]));
      for (const d of j.currencyDetails || []) icon(d.name, d.icon);
      for (const l of j.lines || []) { const t2 = tid.get(l.currencyTypeName); if (t2 && l.chaosEquivalent > 0) out.tradeIds[t2] = l.chaosEquivalent; }
    }
    if (!out.currency[t] || !out.currency[t].length) fallback('currency', t);
    await sleep(250);
  }
  for (const t of ITEM_TYPES) {
    const j = await getJson(`${NINJA}/stash/current/item/overview${q(t)}`);
    if (j) {
      for (const l of j.lines || []) icon(l.name, l.icon);
      out.items[t] = (j.lines || []).filter(l => !(l.chaosValue < (MIN_CHAOS[t] || 0))).map(l => ({
        k: `i|${t}|${l.detailsId}|${l.links || 0}`,
        name: l.name, baseType: l.baseType, variant: l.variant, links: l.links || 0,
        gemLevel: l.gemLevel, gemQuality: l.gemQuality || 0, corrupted: !!l.corrupted,
        mapTier: l.mapTier, itemClass: l.itemClass, v: l.chaosValue, listings: l.listingCount,
        ...(l.levelRequired ? { ilvl: l.levelRequired } : {}), ...(l.itemType ? { itemType: l.itemType } : {}),
        sp: (l.sparkLine?.data || []).some(x => x !== null) ? l.sparkLine.data : l.lowConfidenceSparkLine?.data,
        ...(/^Unique/.test(t) ? {
          ranges: (l.explicitModifiers || []).map(m => m.text).filter(x => /\(-?[\d.]+-/.test(x)),
          iranges: (l.implicitModifiers || []).map(m => m.text).filter(x => /\(-?[\d.]+-/.test(x)),
        } : {}),
      }));
    }
    if (!out.items[t] || !out.items[t].length) fallback('items', t);
    await sleep(250);
  }
  if (!out.core && prev && prev.core) out.core = prev.core;
  if (!Object.keys(out.tradeIds).length && prev && prev.tradeIds) out.tradeIds = prev.tradeIds;
  return out;
}

// --------------------------------------------------------- historique
function compact(points, now) {
  // points : [[minute, valeur], …] triés ; on garde 1 point par case selon l'ancienneté
  const out = [], seen = new Set();
  for (let k = points.length - 1; k >= 0; k--) {
    const [t] = points[k];
    const age = now - t;
    const step = TIERS.find(([lim]) => age <= lim)[1];
    const cell = `${step}:${Math.floor(t / step)}`;
    if (seen.has(cell)) continue;
    seen.add(cell);
    out.push(points[k]);
  }
  return out.reverse();
}

// Format d'un fichier d'historique : { clé: [t0, [écarts en minutes…], [valeurs…]] }, t0 en minutes depuis 1970
export function encodeShard(h) {
  const o = {};
  for (const [k, pts] of Object.entries(h)) {
    const dts = [], vs = [];
    for (let i = 0; i < pts.length; i++) { if (i) dts.push(pts[i][0] - pts[i - 1][0]); vs.push(pts[i][1]); }
    o[k] = [pts[0][0], dts, vs];
  }
  return o;
}
export function decodeShard(o) {
  const h = {};
  for (const [k, [t0, dts, vs]] of Object.entries(o)) {
    let t = t0;
    h[k] = vs.map((v, i) => { if (i) t += dts[i - 1]; return [t, v]; });
  }
  return h;
}

async function updateHistory(dir, prices, recentDir) {
  const now = Math.floor(prices.fetchedAt / 60000);
  const snap = new Map();
  const add = (k, v, always) => { if (k && v > 0 && (always || v >= MIN_HISTORY_CHAOS) && !snap.has(k)) snap.set(k, round(v)); };
  const stale = new Set(prices.stale || []);
  for (const [sec, always] of [['exchange', true], ['currency', true], ['items', false]]) {
    for (const [t, lines] of Object.entries(prices[sec])) if (!stale.has(`${sec}|${t}`)) for (const l of lines) add(l.k, l.v, always);
  }
  await mkdir(dir, { recursive: true });
  const shards = Array.from({ length: SHARDS }, () => new Map());
  for (const [k, v] of snap) shards[shardOf(k)].set(k, v);
  let points = 0, bytes = 0;
  for (let s = 0; s < SHARDS; s++) {
    const file = join(dir, `${s}.json`);
    let h = {};
    if (existsSync(file)) { try { h = decodeShard(JSON.parse(await readFile(file, 'utf8'))); } catch { h = {}; } }
    for (const [k, v] of shards[s]) {
      const arr = h[k] || (h[k] = []);
      if (!arr.length || arr[arr.length - 1][0] < now) arr.push([now, v]);
    }
    for (const k of Object.keys(h)) {
      h[k] = compact(h[k], now);
      if (!h[k].length) delete h[k];
      else points += h[k].length;
    }
    const txt = JSON.stringify(encodeShard(h));
    bytes += txt.length;
    await writeFile(file, txt);
    if (recentDir) {
      // version courte : 7 derniers jours seulement (vues 24 h / 7 j de la page)
      const r = {};
      for (const [k, pts] of Object.entries(h)) { const kept = pts.filter(p => p[0] >= now - 7 * 1440); if (kept.length) r[k] = kept; }
      await mkdir(recentDir, { recursive: true });
      await writeFile(join(recentDir, `${s}.json`), JSON.stringify(encodeShard(r)));
    }
  }
  return { series: snap.size, points, bytes };
}

// ------------------------------------------------------------ uniques
export function parsePobUniques(text, db = {}) {
  const re = /\[\[([\s\S]*?)\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    const lines = m[1].split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const name = lines[0], base = lines[1];
    const variants = [];
    const raw = [];
    let implLeft = 0;
    const META = /^(Variant|Selected Variant|Selected Alt Variant|Selected Alt Variant Two|Has Alt Variant|Has Alt Variant Two|League|Source|Upgrade|Implicits|LevelReq|Sockets|Radius|Limited to|Item Level|Quality|Talisman Tier|Evasion|Armour|Energy Shield|Ward|Catalyst|Requires)\b/;
    for (const l of lines.slice(2)) {
      let mm;
      if ((mm = l.match(/^Variant: (.*)$/))) { variants.push(mm[1]); continue; }
      if ((mm = l.match(/^Implicits: (\d+)$/))) { implLeft = +mm[1]; continue; }
      if (META.test(l) || /^(Shaper|Elder|Crusader|Redeemer|Hunter|Warlord|Searing Exarch|Eater of Worlds) Item$/.test(l)) continue;
      raw.push({ l, impl: implLeft > 0 });
      if (implLeft > 0) implLeft--;
    }
    const cur = variants.length ? (variants.findIndex(v => /^Current/i.test(v)) + 1 || variants.length) : 0;
    const keep = (l) => {
      const vm = l.match(/\{variant:([\d,]+)\}/);
      if (vm && cur && !vm[1].split(',').map(Number).includes(cur)) return null;
      return l.replace(/\{[^}]*\}/g, '').trim();
    };
    const i = [], e = [];
    for (const r of raw) {
      const t = keep(r.l);
      if (!t || !/\(-?[\d.]+-/.test(t)) continue;
      (r.impl ? i : e).push(t);
    }
    if (!i.length && !e.length) continue;
    const v = { b: base, i, e, d: 1 };
    (db[name] = db[name] || []).push(v);
  }
  return db;
}

async function updateUniques(dir) {
  const file = join(dir, 'uniques.json');
  if (existsSync(file)) {
    try { const j = JSON.parse(await readFile(file, 'utf8')); if (Date.now() - j.at < 20 * 3600000) return j.n; } catch {}
  }
  const db = {};
  for (const f of POB_FILES) {
    const r = await fetch(`${POB}/${f}.lua`, { headers: { 'User-Agent': UA } });
    if (r.ok) parsePobUniques(await r.text(), db);
    else console.warn(`PoB ${f} : HTTP ${r.status}`);
  }
  const n = Object.keys(db).length;
  if (n > 500) await writeFile(file, JSON.stringify({ at: Date.now(), source: 'Path of Building', n, db }));
  return n;
}

// ------------------------------------------------ mods du site de trade
async function updateTradeStats(dir) {
  const file = join(dir, 'trade-stats.json');
  if (existsSync(file)) {
    try { const j = JSON.parse(await readFile(file, 'utf8')); if (Date.now() - j.at < 20 * 3600000) return Object.keys(j.map).length; } catch {}
  }
  const j = await getJson('https://www.pathofexile.com/api/trade/data/stats');
  if (!j || !j.result) { console.warn('stats du trade indisponibles'); return 0; }
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

// --------------------------------------------------------------- main
async function main() {
  await mkdir(join(OUT, 'prices'), { recursive: true });
  const leagues = await getJson(`${NINJA}/leagues`);
  if (!leagues || !leagues.length) throw new Error('liste des ligues poe.ninja indisponible');
  // une ligue n'est retirée que lorsqu'elle disparaît de la liste poe.ninja, jamais parce qu'un passage a échoué
  const keepDirs = new Set(leagues.map(lg => slug(lg.id)));
  for (const lg of leagues) {
    const t0 = Date.now();
    const pricesFile = join(OUT, 'prices', `${slug(lg.id)}.json`);
    const extraFile = join(OUT, 'prices-extra', `${slug(lg.id)}.json`);
    let prev = null;
    if (existsSync(pricesFile)) { try { prev = JSON.parse(await readFile(pricesFile, 'utf8')); } catch (e) { console.warn(`${lg.id} : prix précédents illisibles (${e.message})`); } }
    if (prev && existsSync(extraFile)) { try { Object.assign(prev.items, JSON.parse(await readFile(extraFile, 'utf8')).items); } catch (e) { console.warn(`${lg.id} : prix annexes précédents illisibles (${e.message})`); } }
    const p = await fetchLeague(lg.id, prev);
    const stale = new Set(p.stale);
    const count = sec => Object.entries(p[sec]).filter(([t]) => !stale.has(`${sec}|${t}`)).reduce((a, [, l]) => a + l.length, 0);
    const nLines = count('items') + count('exchange');
    if (nLines < 50) { console.warn(`${lg.id} : trop peu de lignes fraîches (${nLines}), prix et historique laissés tels quels`); continue; }
    // fichier principal sans les catégories annexes ; lignes annexes allégées (valeurs par défaut retirées)
    const extra = { league: p.league, fetchedAt: p.fetchedAt, items: {} };
    const main = { ...p, items: { ...p.items } };
    for (const t of EXTRA_TYPES) if (main.items[t]) {
      extra.items[t] = main.items[t].map(({ links, gemQuality, corrupted, gemLevel, mapTier, ...l }) => l);
      delete main.items[t];
    }
    await writeFile(pricesFile, JSON.stringify(main));
    await mkdir(join(OUT, 'prices-extra'), { recursive: true });
    await writeFile(extraFile, JSON.stringify(extra));
    // icônes : fusion avec le fichier précédent (les catégories reprises n'en apportent pas de nouvelles)
    const iconsFile = join(OUT, 'icons', `${slug(lg.id)}.json`);
    let oldIcons = {};
    if (existsSync(iconsFile)) { try { oldIcons = JSON.parse(await readFile(iconsFile, 'utf8')); } catch {} }
    await mkdir(join(OUT, 'icons'), { recursive: true });
    await writeFile(iconsFile, JSON.stringify({ ...oldIcons, ...p.icons }));
    const st = await updateHistory(join(OUT, 'history', slug(lg.id)), p, join(OUT, 'history-recent', slug(lg.id)));
    console.log(`${lg.id} : ${nLines} lignes${p.stale.length ? ` (${p.stale.length} catégories reprises)` : ''}, historique ${st.series} séries / ${st.points} points / ${(st.bytes / 1e6).toFixed(1)} Mo, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  // les ligues terminées disparaissent de poe.ninja : on retire leurs fichiers
  for (const base of ['history', 'history-recent']) {
    if (existsSync(join(OUT, base))) for (const d of await readdir(join(OUT, base))) if (!keepDirs.has(d)) await rm(join(OUT, base, d), { recursive: true });
  }
  for (const base of ['prices', 'prices-extra', 'icons']) {
    if (existsSync(join(OUT, base))) for (const f of await readdir(join(OUT, base))) if (!keepDirs.has(f.replace(/\.json$/, ''))) await rm(join(OUT, base, f));
  }
  await writeFile(join(OUT, 'leagues.json'), JSON.stringify({ at: Date.now(), leagues: leagues.map(l => ({ id: l.id, name: l.name, file: slug(l.id) })), shards: SHARDS }));
  const nu = await updateUniques(OUT);
  console.log(`uniques : ${nu}`);
  const ns = await updateTradeStats(OUT);
  console.log(`mods du trade : ${ns}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
