// ==UserScript==
// @name         PoE1 – Scanner de coffres
// @namespace    https://github.com/MrPatatatomique/poe-coffres
// @author       MrPatatatomique
// @homepageURL  https://github.com/MrPatatatomique/poe-coffres
// @supportURL   https://github.com/MrPatatatomique/poe-coffres/issues
// @updateURL    https://mrpatatatomique.github.io/poe-coffres/poe-stash-scanner.user.js
// @downloadURL  https://mrpatatatomique.github.io/poe-coffres/poe-stash-scanner.user.js
// @version      2.8.1
// @description  Scanne les coffres PoE1, garde le dernier scan et alimente la page coffres-poe1.html (prix poe.ninja inclus)
// @match        https://www.pathofexile.com/*
// @match        file:///*coffres-poe1*.html*
// @match        *://*/*coffres-poe1*.html*
// @include      /^https?:\/\/(localhost|127\.0\.0\.1|[\d.]+)(:\d+)?\/.*coffres-poe1[^/]*\.html.*$/
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_listValues
// @connect      www.pathofexile.com
// @connect      poe.ninja
// @run-at       document-idle
// ==/UserScript==
(() => {
  'use strict';
  if (window.top !== window.self) return;

  const ON_GGG = location.hostname === 'www.pathofexile.com';
  const GGG = 'https://www.pathofexile.com/character-window';
  const NINJA = 'https://poe.ninja/poe1/api/economy';
  const REALM = 'pc';
  const NINJA_TTL = 15 * 60 * 1000; // poe.ninja se met à jour toutes les ~15 min
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- Stockage partagé (même stockage pour le site GGG et la page) ----------
  const getSettings = () => GM_getValue('settings', {}) || {};
  const setSettings = patch => GM_setValue('settings', { ...getSettings(), ...patch });

  // ---------- HTTP : fetch sur le site GGG, GM_xmlhttpRequest ailleurs ----------
  const IS_GGG_URL = u => u.startsWith('https://www.pathofexile.com/');
  const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} : pas de réponse après ${ms / 1000} s`)), ms))]);
  function ggFetch(url, method, body) {
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(url, { method, credentials: 'include', headers, body })
      .then(async r => { const h = {}; r.headers.forEach((v, k) => (h[k.toLowerCase()] = v)); return { status: r.status, headers: h, text: await r.text() }; });
  }
  const INSTANCE = Math.random().toString(36).slice(2, 10);
  const logErr = (what, e) => console.warn(`[Coffres] ${what} :`, e);
  // Nettoyage des clés laissées par le relais et la base poewiki (supprimés en 2.6.6)
  for (const k of ['gggAlive', 'relayTab', 'relayPing', 'relayAck', 'relayDone', 'uniqueDb']) GM_deleteValue(k);
  for (const k of typeof GM_listValues === 'function' ? GM_listValues() : []) if (/^relay(Req|Res)_/.test(k)) GM_deleteValue(k);
  const wrap = r => ({ status: r.status, header: n => (r.headers || {})[n.toLowerCase()] ?? null, text: r.text, error: r.error });

  function http(url, method = 'GET', body = null) {
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    if (body) headers['Content-Type'] = 'application/json';
    if (IS_GGG_URL(url)) {
      if (ON_GGG) return withTimeout(ggFetch(url, method, body), 45000, 'pathofexile.com').then(wrap);
    }
    return withTimeout(new Promise((resolve, reject) => GM_xmlhttpRequest({
      url, method, headers, data: body || undefined,
      timeout: 30000,
      onload: r => {
        const h = {};
        (r.responseHeaders || '').split(/\r?\n/).forEach(l => { const i = l.indexOf(':'); if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); });
        resolve({ status: r.status, header: n => h[n.toLowerCase()] ?? null, text: r.responseText });
      },
      onerror: () => reject(new Error(IS_GGG_URL(url) ? 'pathofexile.com injoignable depuis cette page : ouvre un onglet pathofexile.com (il sert de relais), puis réessaie.' : `Erreur réseau sur ${url}`)),
      ontimeout: () => reject(new Error(IS_GGG_URL(url) ? 'pathofexile.com ne répond pas depuis cette page : ouvre un onglet pathofexile.com (il sert de relais), puis réessaie.' : `Délai dépassé sur ${url}`)),
      onabort: () => reject(new Error(`Requête annulée : ${url}`)),
    })), 40000, IS_GGG_URL(url) ? 'pathofexile.com (ouvre un onglet pathofexile.com, il sert de relais)' : url);
  }

  // ---------- API GGG avec respect des limites ----------
  let nextAllowed = 0;
  const parseRules = s => (s || '').split(',').filter(Boolean).map(r => r.split(':').map(Number));
  function throttle(res) { nextAllowed = Date.now() + throttleDelay(res, 1500); }
  function throttleDelay(res, floor) {
    let delay = floor;
    for (const scope of ['Account', 'Ip']) {
      const limits = parseRules(res.header(`X-Rate-Limit-${scope}`));
      const states = parseRules(res.header(`X-Rate-Limit-${scope}-State`));
      limits.forEach(([max, period], i) => {
        const [hits = 0, , penalty = 0] = states[i] || [];
        if (penalty > 0) delay = Math.max(delay, penalty * 1000 + 1000);
        else if (hits >= max - 1) delay = Math.max(delay, period * 1000 + 1000);
        else if (period <= 60) delay = Math.max(delay, (period * 1000) / max + 200); // on lisse seulement les fenêtres courtes
      });
    }
    return delay;
  }

  async function ggg(path, params = {}, method = 'GET', onWait) {
    const url = new URL(GGG + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    for (let attempt = 0; attempt < 5; attempt++) {
      const wait = nextAllowed - Date.now();
      if (wait > 0) { if (wait > 3000 && onWait) onWait(wait); await sleep(wait); }
      const res = await http(url.toString(), method);
      if (!res.status) throw new Error(res.error || 'pathofexile.com injoignable');
      throttle(res);
      if (res.status === 429) { nextAllowed = Date.now() + ((Number(res.header('Retry-After')) || 60) * 1000 + 1000); continue; }
      if (res.status === 401 || res.status === 403) { const e = new Error('Accès refusé : connecte-toi sur pathofexile.com dans ce navigateur.'); e.auth = true; throw e; }
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} sur ${path}`);
      const j = JSON.parse(res.text);
      if (j && j.error) { const e = new Error(j.error.message || JSON.stringify(j.error)); if (j.error.code === 6 || /forbidden|log/i.test(e.message)) e.auth = true; throw e; }
      return j;
    }
    throw new Error('Trop de refus (429), scan interrompu.');
  }

  function flattenTabs(tabs, folder = '') {
    const out = [];
    for (const t of tabs || []) {
      const name = folder ? `${folder} / ${t.n}` : t.n;
      if (Array.isArray(t.children) && t.children.length) out.push(...flattenTabs(t.children, t.n));
      else if (typeof t.i === 'number') out.push({ i: t.i, n: name, type: t.type, colour: t.colour, id: t.id });
    }
    return out;
  }

  // ---------- Personnages : équipement porté et inventaire, pour la ligue choisie ----------
  async function runChars(report = () => {}, leagueHint = '') {
    const st = getSettings();
    const league = leagueHint || st.league;
    if (!st.account || !league) throw new Error('Compte et ligue inconnus : fais un premier scan depuis pathofexile.com (bouton Coffres).');
    report({ msg: 'Personnages : liste…' });
    const onWait = ms => report({ msg: `Personnages : limite de requêtes GGG, reprise dans ${Math.ceil(ms / 1000)} s…` });
    const list = (await ggg('/get-characters', { accountName: st.account, realm: REALM }, 'GET', onWait) || []).filter(c => c.league === league);
    const chars = [], failed = [];
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      report({ msg: `Personnages ${k + 1}/${list.length} : ${c.name}`, p: k / list.length });
      try {
        const j = await ggg('/get-items', { accountName: st.account, character: c.name, realm: REALM }, 'GET', onWait);
        chars.push({ name: c.name, class: c.class, level: c.level, league: c.league, items: j.items || [] });
      } catch (e) {
        failed.push({ name: c.name, error: e.message });
        if (e.auth) throw e;
      }
    }
    const out = { format: 'poe1-characters', at: new Date().toISOString(), account: st.account, league, chars, failed };
    GM_setValue('lastChars', JSON.stringify(out));
    report({ msg: `Personnages : ${chars.length} importé${chars.length > 1 ? 's' : ''}${failed.length ? `, ${failed.length} en échec` : ''}.`, p: 1, done: true });
    return out;
  }

  // ---------- Relais : la page confie scans et imports à un onglet pathofexile.com ----------
  // gggRequest {id, kind, data, at} -> l'onglet GGG accuse réception puis publie sa progression dans gggStatus {id, msg, p, error, done, at}
  async function relayToGGG(kind, data, report) {
    const id = Math.random().toString(36).slice(2, 10);
    GM_setValue('gggRequest', { id, kind, data, at: Date.now() });
    report({ msg: `${kind === 'scan' ? 'Scan' : 'Personnages'} : demande transmise à l'onglet pathofexile.com…` });
    let lastAt = Date.now(), acked = false, lastMsg = '';
    while (true) {
      await sleep(1000);
      const st = GM_getValue('gggStatus', null);
      if (st && st.id === id) {
        if (!acked) acked = true;
        if (st.at > lastAt || st.msg !== lastMsg) { lastAt = Math.max(lastAt, st.at); lastMsg = st.msg; report({ msg: st.msg, p: st.p, error: st.error, done: st.done }); }
        if (st.done || st.error) return !st.error;
      }
      if (!acked && Date.now() - lastAt > 8000) {
        report({ msg: `${kind === 'scan' ? 'Scan' : 'Personnages'} : aucun onglet pathofexile.com n'a pris la demande. Ouvre pathofexile.com (connecté) dans ce navigateur, recharge-le si le script vient d'être mis à jour, puis réessaie.`, error: true });
        return false;
      }
      if (acked && Date.now() - lastAt > 180000) { report({ msg: `${kind === 'scan' ? 'Scan' : 'Personnages'} : l'onglet pathofexile.com ne donne plus de nouvelles depuis 3 min.`, error: true }); return false; }
    }
  }

  // ---------- Scan complet (utilisé par le panneau GGG et par la page) ----------
  let scanning = false;
  async function runScan(report0 = () => {}, { tabsOverride } = {}) {
    // verrou partagé entre onglets, prolongé à chaque étape : un scan interrompu (onglet fermé) le libère en 2 min
    const report = d => { GM_setValue('scanLock', Date.now() + 120000); report0(d); };
    const st = getSettings();
    const account = st.account, league = st.league;
    if (!account || !league) throw new Error('Compte et ligue inconnus : fais un premier scan depuis pathofexile.com (bouton Coffres).');
    const lock = GM_getValue('scanLock', 0);
    if (scanning || lock > Date.now()) throw new Error(`Un scan est déjà en cours (libéré au plus tard dans ${Math.max(1, Math.ceil((lock - Date.now()) / 1000))} s s'il est bloqué).`);
    scanning = true;
    GM_setValue('scanLock', Date.now() + 120000);
    const onWait = w => report({ msg: `Limite de requêtes GGG : pause ${Math.ceil(w / 1000)} s…` });
    try {
      report({ msg: 'Lecture de la liste des onglets…', p: 0 });
      const first = await ggg('/get-stash-items', { accountName: account, realm: REALM, league, tabs: 1, tabIndex: 0 }, 'GET', onWait);
      const all = flattenTabs(first.tabs);
      const wanted = new Set(tabsOverride || st.selected?.[league] || all.map(t => t.i));
      const chosen = all.filter(t => wanted.has(t.i));
      const items = [], scannedTabs = [], failed = [];
      for (let k = 0; k < chosen.length; k++) {
        const tab = chosen[k];
        report({ msg: `Onglet ${k + 1}/${chosen.length} : ${tab.n}`, p: k / chosen.length });
        try {
          const j = tab.i === 0 ? first : await ggg('/get-stash-items', { accountName: account, realm: REALM, league, tabs: 0, tabIndex: tab.i }, 'GET', onWait);
          const list = j.items || [];
          for (const it of list) items.push({ ...it, _tab: { i: tab.i, n: tab.n, type: tab.type } });
          scannedTabs.push({ ...tab, itemCount: list.length });
        } catch (e) {
          failed.push({ i: tab.i, n: tab.n, error: e.message });
          if (e.auth || /Trop de refus/.test(e.message)) throw e;
        }
      }
      const scan = { format: 'poe1-stash-scan', version: 1, scannedAt: new Date().toISOString(), account, league, realm: REALM, tabs: scannedTabs, failedTabs: failed, items };
      GM_setValue('lastScan', JSON.stringify(scan));
      GM_setValue('lastScanAt', Date.now());
      GM_setValue('authFailedAt', 0);
      report({ msg: `Scan terminé : ${items.length} objets, ${scannedTabs.length} onglets.`, p: 1, done: true });
      return scan;
    } catch (e) {
      if (e.auth) GM_setValue('authFailedAt', Date.now());
      throw e;
    } finally {
      scanning = false;
      GM_setValue('scanLock', 0);
    }
  }

  // ---------- Prix poe.ninja ----------
  // @@ninja-begin : copie de shared/ninja.js insérée par `node tools/build-userscript.mjs`, ne pas modifier ici
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
  // @@ninja-end
  const { EXCHANGE_TYPES, STASH_CURRENCY_TYPES, EXTRA_TYPES } = PoeNinja;
  // le script ne récupère pas les catégories annexes (16 000 bases…) : elles viennent du dépôt
  const ITEM_TYPES = PoeNinja.ITEM_TYPES.filter(t => !EXTRA_TYPES.includes(t));

  async function ninjaGet(path) {
    const res = await http(NINJA + path);
    if (res.status !== 200) throw new Error(`poe.ninja HTTP ${res.status}`);
    return JSON.parse(res.text);
  }

  function pickNinjaLeague(leagues, gggLeague) {
    if (!gggLeague) throw new Error('ligue inconnue (aucun scan enregistré).');
    const l = PoeNinja.pickLeague(leagues, gggLeague);
    if (!l) throw new Error(`Ligue « ${gggLeague} » introuvable sur poe.ninja.`);
    return l.id;
  }

  // Ligue des prix : celle demandée par la page, sinon celle des réglages, sinon celle du dernier scan
  function priceLeague(hint) {
    if (hint) return hint;
    const st = getSettings();
    if (st.league) return st.league;
    try { return JSON.parse(GM_getValue('lastScan', '{}')).league || ''; } catch { return ''; }
  }
  async function loadPrices(force = false, report = () => {}, leagueHint = '') {
    const st = { ...getSettings(), league: priceLeague(leagueHint) };
    const cached = GM_getValue('ninjaPrices', null);
    if (!force && cached && cached.gggLeague === st.league && Date.now() - cached.fetchedAt < NINJA_TTL) return cached;
    report({ msg: 'Récupération des prix poe.ninja…' });
    const leagues = await ninjaGet('/leagues');
    const league = pickNinjaLeague(leagues, st.league);
    const q = t => `?league=${encodeURIComponent(league)}&type=${t}`;
    const out = { gggLeague: st.league, league, fetchedAt: Date.now(), exchange: {}, currency: {}, items: {}, core: null, tradeIds: {} };
    let n = 0;
    const total = EXCHANGE_TYPES.length + STASH_CURRENCY_TYPES.length + ITEM_TYPES.length;
    for (const t of EXCHANGE_TYPES) {
      report({ msg: `poe.ninja : ${t} (${++n}/${total})` });
      try {
        const r = PoeNinja.exchangeLines(await ninjaGet(`/exchange/current/overview${q(t)}`));
        out.exchange[t] = r.lines;
        if (t === 'Currency') out.core = r.core;
      } catch (e) { logErr(`poe.ninja ${t} (exchange)`, e); }
      await sleep(150);
    }
    for (const t of STASH_CURRENCY_TYPES) {
      report({ msg: `poe.ninja : ${t} (${++n}/${total})` });
      try {
        const r = PoeNinja.currencyLines(await ninjaGet(`/stash/current/currency/overview${q(t)}`));
        out.currency[t] = r.lines;
        Object.assign(out.tradeIds, r.tradeIds);
      } catch (e) { logErr(`poe.ninja ${t} (currency)`, e); }
      await sleep(150);
    }
    for (const t of ITEM_TYPES) {
      report({ msg: `poe.ninja : ${t} (${++n}/${total})` });
      try {
        out.items[t] = PoeNinja.itemLines(t, await ninjaGet(`/stash/current/item/overview${q(t)}`)).lines;
      } catch (e) { logErr(`poe.ninja ${t} (items)`, e); }
      await sleep(150);
    }
    GM_setValue('ninjaPrices', out);
    report({ msg: `Prix poe.ninja à jour (ligue ${league}).` });
    return out;
  }

  // ---------- Estimation par le site de trade ----------
  const TRADE = 'https://www.pathofexile.com/api/trade';
  const tradeNext = {};
  const modText = m => typeof m === 'string' ? m : (m && (m.text ?? m.description ?? m.name)) || '';
  const clean = s => String(s ?? '').replace(/<<[^>]*>>/g, '').replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1');
  const IGNORE = [/Light Radius/i, /Stun and Block Recovery/i, /Attribute Requirements/i, /^Reflects \d+ Physical Damage/i, /increased Stun Duration on Enemies/i];
  const GEAR_PROPS = ['Armour', 'Evasion Rating', 'Energy Shield', 'Ward', 'Physical Damage', 'Elemental Damage', 'Attacks per Second', 'Critical Strike Chance', 'Chance to Block'];

  async function tradeReq(kind, url, method = 'GET', body = null, report = () => {}) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const wait = (tradeNext[kind] || 0) - Date.now();
      if (wait > 0) { if (wait > 2000) report({ msg: `Limite du trade (${kind === 'search' ? 'recherches' : 'annonces'}) : pause ${Math.ceil(wait / 1000)} s…` }); await sleep(wait); }
      const res = await http(url, method, body);
      if (!res.status) throw new Error(res.error || 'pathofexile.com injoignable');
      tradeNext[kind] = Date.now() + throttleDelay(res, kind === 'search' ? 1200 : 500);
      if (res.status === 429) { tradeNext[kind] = Date.now() + ((Number(res.header('Retry-After')) || 60) * 1000 + 1000); continue; }
      if (res.status < 200 || res.status >= 300) {
        let msg = `Trade : HTTP ${res.status}`;
        try { const j = JSON.parse(res.text); if (j.error) msg += ` (${j.error.message})`; } catch { /* réponse sans JSON : le code HTTP suffit */ }
        throw new Error(msg);
      }
      try { return JSON.parse(res.text); }
      catch { throw new Error('Le trade a renvoyé une page au lieu des résultats (vérification Cloudflare ?). Ouvre un onglet pathofexile.com/trade, puis réessaie.'); }
    }
    throw new Error('Trade : trop de refus (429), réessaie dans une minute.');
  }

  async function loadStats(report) {
    const c = GM_getValue('tradeStats', null);
    if (c && Date.now() - c.at < 86400000) return c;
    report({ msg: 'Chargement de la liste des mods du trade…' });
    let j;
    try { j = await tradeReq('data', `${TRADE}/data/stats`); }
    catch (e) { throw new Error(/JSON|Unexpected/.test(e.message) ? 'le site de trade a renvoyé une page au lieu des données (vérification Cloudflare ?). Ouvre pathofexile.com/trade une fois, puis réessaie.' : e.message); }
    const map = {}, ids = {};
    for (const g of j.result || []) for (const e of g.entries || []) {
      ids[e.id] = e.text;
      if (e.option) continue;
      const k = `${e.type}|${e.text}`;
      if (!map[k]) map[k] = e.id;
    }
    const out = { at: Date.now(), map, ids };
    GM_setValue('tradeStats', out);
    return out;
  }

  function parseMods(item, stats) {
    const isGear = (item.properties || []).some(p => GEAR_PROPS.includes(clean(p.name)));
    const hasPseudo = stats.ids['pseudo.pseudo_total_life'] && stats.ids['pseudo.pseudo_total_elemental_resistance'];
    const groups = [['enchantMods', 'enchant'], ['implicitMods', 'implicit'], ['fracturedMods', 'fractured'], ['explicitMods', 'explicit'], ['craftedMods', 'crafted']];
    const out = [], used = new Set();
    let life = 0, res = 0, chaosRes = 0;
    const find = (type, t) => (isGear && stats.map[`${type}|${t} (Local)`]) || stats.map[`${type}|${t}`];
    for (const [field, type] of groups) for (const full of item[field] || []) for (const line of clean(modText(full)).split('\n')) {
      const nums = (line.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      const t = line.replace(/\d+(?:\.\d+)?/g, '#');
      if (hasPseudo && type !== 'enchant') {
        if (/^\+# to maximum Life$/.test(t)) { life += nums[0]; continue; }
        if (/^\+#% to all Elemental Resistances$/.test(t)) { res += nums[0] * 3; continue; }
        if (/^\+#% to (Fire|Cold|Lightning) Resistance$/.test(t)) { res += nums[0]; continue; }
        if (/^\+#% to (Fire|Cold|Lightning) and (Fire|Cold|Lightning) Resistances$/.test(t)) { res += nums[0] * 2; continue; }
        if (/^\+#% to Chaos Resistance$/.test(t)) { chaosRes += nums[0]; continue; }
        if (/^\+#% to (Fire|Cold|Lightning) and Chaos Resistances$/.test(t)) { res += nums[0]; chaosRes += nums[0]; continue; }
      }
      let id = find(type, t), neg = false;
      if (!id) {
        const t2 = t.replace(/\breduced\b/, 'increased').replace(/\bless\b/, 'more');
        if (t2 !== t && (id = find(type, t2))) neg = true;
      }
      if (!id) { out.push({ text: line, type, id: null, enabled: false }); continue; }
      if (used.has(id)) continue;
      used.add(id);
      const v = nums.length >= 2 && /^Adds # to #/.test(t) ? (nums[0] + nums[1]) / 2 : (nums.length ? nums[0] : null);
      out.push({ text: line, type, id, value: v === null ? null : (neg ? -v : v), pct: 85, enabled: type !== 'enchant' && !IGNORE.some(r => r.test(line)) });
    }
    const pseudo = (id, text, v) => { if (v > 0 && stats.ids[id]) out.unshift({ text, type: 'pseudo', id, value: v, pct: 85, enabled: true }); };
    pseudo('pseudo.pseudo_total_chaos_resistance', `+${chaosRes}% résistance au chaos (total)`, chaosRes);
    pseudo('pseudo.pseudo_total_elemental_resistance', `+${res}% résistances élémentaires (total)`, res);
    pseudo('pseudo.pseudo_total_life', `+${life} vie maximum (total)`, life);
    return out;
  }

  const INFL = { shaper: 'Shaper', elder: 'Elder', crusader: 'Crusader', redeemer: 'Redeemer', hunter: 'Hunter', warlord: 'Warlord' };
  function itemExtras(item) {
    const ex = [];
    for (const k of Object.keys(INFL)) if (item.influences && item.influences[k]) ex.push({ key: k, label: INFL[k], kind: 'stat', id: `pseudo.pseudo_has_${k}_influence`, enabled: true });
    if (item.searing) ex.push({ key: 'searing', label: 'Searing Exarch', kind: 'misc', id: 'searing_item', enabled: true });
    if (item.tangled) ex.push({ key: 'tangled', label: 'Eater of Worlds', kind: 'misc', id: 'tangled_item', enabled: true });
    if (item.fractured) ex.push({ key: 'fractured', label: 'Fracturé', kind: 'misc', id: 'fractured_item', enabled: true });
    if (item.synthesised) ex.push({ key: 'synth', label: 'Synthétisé', kind: 'misc', id: 'synthesised_item', enabled: true });
    if (item.ilvl) ex.push({ key: 'ilvl', label: `iLvl ≥ ${item.ilvl}`, kind: 'ilvl', value: item.ilvl, enabled: false });
    ex.push({ key: 'corrupted', label: item.corrupted ? 'Corrompu' : 'Non corrompu', kind: 'misc', id: 'corrupted', value: item.corrupted ? 'true' : 'false', enabled: false });
    return ex;
  }

  function buildQuery(item, mods, extras, countMin) {
    const filters = mods.filter(m => m.enabled && m.id).map(m => ({
      id: m.id,
      value: m.value === null || m.value === undefined || m.value < 0 ? {} : { min: Math.floor(m.value * (m.pct || 85) / 100 * 100) / 100 },
    }));
    const misc = {};
    for (const e of extras || []) {
      if (!e.enabled) continue;
      if (e.kind === 'stat') filters.push({ id: e.id, value: {} });
      else if (e.kind === 'misc') misc[e.id] = { option: e.value || 'true' };
      else if (e.kind === 'ilvl') misc.ilvl = { min: e.value };
    }
    const st = getSettings();
    const q = {
      query: {
        status: { option: 'online' },
        stats: [countMin ? { type: 'count', value: { min: countMin }, filters } : { type: 'and', filters }],
        filters: {
          trade_filters: { filters: { sale_type: { option: 'priced' }, ...(st.tradeIndexed === 'any' ? {} : { indexed: { option: st.tradeIndexed || '1week' } }) } },
          type_filters: { filters: { rarity: { option: item.frameType === 1 ? 'magic' : 'nonunique' } } },
        },
      },
      sort: { price: 'asc' },
    };
    if (Object.keys(misc).length) q.query.filters.misc_filters = { filters: misc };
    const base = clean(item.baseType || item.typeLine);
    if (base) q.query.type = base;
    return q;
  }

  function currencyRates(p) {
    const r = { chaos: 1 };
    if (!p) return r;
    Object.assign(r, p.tradeIds || {});
    if (!r.divine && p.core?.rates?.divine && p.core.primary === 'chaos') r.divine = 1 / p.core.rates.divine;
    return r;
  }

  function summarize(v) {
    if (!v.length) return { estimate: null, n: 0 };
    const cut = v.length >= 10 ? Math.floor(v.length * 0.1) : 0;
    const core = v.slice(cut, v.length - cut);
    return { estimate: core.reduce((a, b) => a + b, 0) / core.length, median: v[Math.floor(v.length / 2)], min: v[0], max: v[v.length - 1], n: v.length };
  }

  async function tradeEstimate(itemId, item, customMods, customExtras, report) {
    const league = getSettings().league;
    if (!league) throw new Error('Ligue inconnue : fais un premier scan.');
    const mods = customMods || parseMods(item, await loadStats(report));
    const extras = customExtras || itemExtras(item);
    const rates = currencyRates(GM_getValue('ninjaPrices', null));
    const n = mods.filter(m => m.enabled && m.id).length;
    const steps = customMods ? [0] : [0, Math.max(1, n - 1), Math.max(1, Math.ceil(n / 2))].filter((c, k, a) => k === 0 || (n > 1 && c < n && c !== a[k - 1]));
    let search = null, countMin = 0;
    for (const c of steps) {
      report({ msg: `Recherche sur le trade${c ? ` (assouplie : ${c} mods sur ${n})` : ''}…` });
      search = await tradeReq('search', `${TRADE}/search/${encodeURIComponent(league)}`, 'POST', JSON.stringify(buildQuery(item, mods, extras, c)), report);
      countMin = c;
      if ((search.total || 0) >= 8) break;
    }
    const ids = (search.result || []).slice(0, 50);
    const listings = [];
    for (let k = 0; k < ids.length; k += 10) {
      report({ msg: `Annonces ${k + 1} à ${Math.min(k + 10, ids.length)} sur ${ids.length}…` });
      const j = await tradeReq('fetch', `${TRADE}/fetch/${ids.slice(k, k + 10).join(',')}?query=${search.id}`, 'GET', null, report);
      for (const r of j.result || []) {
        const p = r && r.listing && r.listing.price;
        if (!p) continue;
        const it = r.item || {};
        listings.push({
          id: r.id, amount: p.amount, currency: p.currency, chaos: rates[p.currency] ? p.amount * rates[p.currency] : null,
          seller: r.listing.account?.name, indexed: r.listing.indexed,
          item: { name: clean(it.name), typeLine: clean(it.typeLine), ilvl: it.ilvl, corrupted: !!it.corrupted,
            mods: [...(it.implicitMods || []), ...(it.fracturedMods || []), ...(it.explicitMods || []), ...(it.craftedMods || [])].map(m => clean(modText(m))),
            influences: Object.keys(it.influences || {}) },
        });
      }
    }
    const vals = listings.map(l => l.chaos).filter(v => v > 0).sort((a, b) => a - b);
    const rec = { itemId, at: Date.now(), league, queryId: search.id, total: search.total || 0, countMin, nMods: n, mods, extras, listings, divine: rates.divine || 0, ...summarize(vals) };
    const all = GM_getValue('tradeEstimates', {});
    all[itemId] = rec;
    GM_setValue('tradeEstimates', all);
    report({ msg: rec.estimate ? `Estimation trade terminée : ${rec.n} annonces.` : 'Aucune annonce trouvée sur le trade.', error: !rec.estimate });
    return rec;
  }

  // ---------- Rescan automatique (le premier contexte disponible s'en charge) ----------
  async function autoTick(report) {
    const mins = Number(getSettings().autoMinutes) || 0;
    if (!mins || scanning || !ON_GGG) return;
    const last = GM_getValue('lastScanAt', 0);
    if (Date.now() - last < mins * 60000) return;
    if (GM_getValue('scanLock', 0) > Date.now()) return;
    // Si la page n'a pas les cookies GGG, on laisse l'onglet pathofexile.com s'en charger pendant 1 h
    if (!ON_GGG && Date.now() - GM_getValue('authFailedAt', 0) < 3600000) return;
    try { await runScan(report); } catch (e) { report({ msg: `Rescan auto : ${e.message}`, error: true }); return; }
    if (getSettings().withChars) { try { await runChars(() => {}); } catch (e) { logErr('personnages au rescan auto', e); } }
  }

  if (ON_GGG) gggPanel(); else viewerBridge();

  // =====================================================================
  // Pont avec la page coffres-poe1.html
  // =====================================================================
  function viewerBridge() {
    const send = (type, data) => window.postMessage(JSON.stringify({ src: 'poe-us', type, data }), '*');
    const report = d => send('status', d);
    const pushScan = () => { const s = GM_getValue('lastScan', null); if (s) send('scan', s); };
    const pushChars = () => { const s = GM_getValue('lastChars', null); if (s) send('chars', s); };
    const pushPrices = p => p && send('prices', JSON.stringify(p));
    const pushSettings = () => send('settings', getSettings());
    const pushTrades = () => send('trades', JSON.stringify(GM_getValue('tradeEstimates', {})));
    let tradeQueue = Promise.resolve(), tradeQueued = 0;
    const pushTracking = () => send('tracking', JSON.stringify({ follow: GM_getValue('follow', {}), history: GM_getValue('priceHistory', {}) }));

    let greeted = false;
    async function greet() {
      if (greeted) return;
      greeted = true;
      // instance : permet à la page de repérer deux copies du script installées en même temps
      send('ready', { version: GM_info.script.version, inst: INSTANCE, scans: !!GM_getValue('lastScan', '') });
      pushSettings(); pushTracking(); pushTrades(); pushScan(); pushChars();
      const p = GM_getValue('ninjaPrices', null);
      if (p) pushPrices(p);
      // sans ligue connue (aucun scan dans ce script), pas de récupération automatique : la page fournit ses prix
      if (!priceLeague()) return;
      if (!getSettings().ninjaRemote && (!p || Date.now() - p.fetchedAt > NINJA_TTL || p.gggLeague !== priceLeague())) pushPrices(await loadPrices(false, report));
    }

    window.addEventListener('message', async ev => {
      if (ev.source !== window || typeof ev.data !== 'string') return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || m.src !== 'poe-viewer') return;
      try {
        if (m.cmd === 'hello') {
          await greet();
        } else if (m.cmd === 'prices-set') {
          GM_setValue('ninjaPrices', { ...m.data, gggLeague: m.data.gggLeague || getSettings().league });
          if (!getSettings().ninjaRemote) setSettings({ ninjaRemote: true });
        } else if (m.cmd === 'scan') {
          if (await relayToGGG('scan', {}, report)) { pushScan(); pushChars(); }
        } else if (m.cmd === 'chars') {
          if (await relayToGGG('chars', { league: (m.data && m.data.league) || '' }, report)) pushChars();
        } else if (m.cmd === 'prices') {
          pushPrices(await loadPrices(true, report, (m.data && m.data.league) || ''));
        } else if (m.cmd === 'trade-prepare') {
          const { itemId, item } = m.data;
          try {
            const stats = await loadStats(report);
            send('trade-draft', JSON.stringify({ itemId, mods: parseMods(item, stats), extras: itemExtras(item) }));
          } catch (e) { send('trade-draft-error', { itemId, msg: `Liste des mods du trade indisponible : ${e.message}` }); throw e; }
        } else if (m.cmd === 'trade') {
          const { itemId, item, mods, extras } = m.data;
          if (tradeQueued) report({ msg: 'Recherche en attente : une autre recherche trade est en cours…' });
          tradeQueued++;
          tradeQueue = tradeQueue.then(() => withTimeout(tradeEstimate(itemId, item, mods, extras, report), 240000, 'Recherche trade'))
            .then(rec => send('trade-result', JSON.stringify(rec)))
            .catch(e => { report({ msg: e.message, error: true }); send('trade-error', { itemId }); })
            .finally(() => { tradeQueued--; });
        } else if (m.cmd === 'trade-store') {
          const all = GM_getValue('tradeEstimates', {}); all[m.data.itemId] = m.data; GM_setValue('tradeEstimates', all);
        } else if (m.cmd === 'trade-delete') {
          const all = GM_getValue('tradeEstimates', {}); delete all[m.data.itemId]; GM_setValue('tradeEstimates', all);
        } else if (m.cmd === 'tracking') {
          if (m.data.follow) GM_setValue('follow', m.data.follow);
          if (m.data.history) GM_setValue('priceHistory', m.data.history);
        } else if (m.cmd === 'settings') {
          setSettings(m.data || {}); pushSettings();
        }
      } catch (e) {
        report({ msg: e.message, error: true });
      }
    });

    // Un scan fait depuis l'onglet GGG met la page à jour toute seule
    GM_addValueChangeListener('lastScan', (k, o, n, remote) => { if (remote && n) send('scan', n); });
    GM_addValueChangeListener('lastChars', (k, o, n, remote) => { if (remote && n) send('chars', n); });
    GM_addValueChangeListener('ninjaPrices', (k, o, n, remote) => { if (remote && n) pushPrices(n); });

    // Le script se charge après la page : on se présente tout de suite, sans attendre son "hello"
    greet().catch(e => report({ msg: e.message, error: true }));

    // Rafraîchissement des prix indépendant du scan, tant que la page est ouverte
    let pricesBusy = false;
    setInterval(async () => {
      const p = GM_getValue('ninjaPrices', null);
      if (getSettings().ninjaRemote || pricesBusy || !priceLeague() || (p && p.gggLeague === priceLeague() && Date.now() - p.fetchedAt < NINJA_TTL)) return;
      pricesBusy = true;
      try { pushPrices(await loadPrices(false, () => {})); }
      catch (e) { report({ msg: `Prix poe.ninja : ${e.message}`, error: true }); }
      finally { pricesBusy = false; }
    }, 60000);

    let charsAt = GM_getValue('lastChars', '').slice(0, 90);
    setInterval(() => autoTick(d => { report(d); if (d.done) { pushScan(); if (!getSettings().ninjaRemote) loadPrices(false, report).then(pushPrices).catch(e => logErr('prix poe.ninja après rescan auto', e)); } }).then(() => { const n = GM_getValue('lastChars', ''); if (n.slice(0, 90) !== charsAt) { charsAt = n.slice(0, 90); pushChars(); } }), 60000);
  }

  // =====================================================================
  // Panneau sur pathofexile.com (premier réglage + scan manuel)
  // =====================================================================
  function gggPanel() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const VER = GM_info.script.version;
    const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h18v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 10a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4"/><path d="M10 13h4v3h-4z"/></svg>';
    root.innerHTML = `
    <style>
      :host{all:initial}
      [hidden]{display:none!important}
      *{box-sizing:border-box;margin:0;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
      svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
      .fab{display:flex;align-items:center;gap:8px;margin-left:auto;background:#17130f;color:#ecd29a;border:1px solid #5a4a32;border-radius:999px;padding:8px 14px 8px 11px;cursor:pointer;box-shadow:0 4px 18px #0008}
      .fab:hover,.fab:focus-visible{border-color:#c8a35a;outline:none}
      .fab .v{color:#8f826d;font-size:11px}
      .fab .dot{width:7px;height:7px;border-radius:50%;background:#5f5444}
      .fab .dot.ok{background:#86c06c}
      .panel{display:none;flex-direction:column;width:380px;max-height:min(640px,calc(100vh - 80px));background:#120f0c;color:#e6dccb;border:1px solid #5a4a32;border-radius:12px;margin-bottom:10px;box-shadow:0 12px 40px #000c;overflow:hidden}
      .panel.open{display:flex}
      .hd{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #2b241b;background:#17130f}
      .hd .ic{color:#c8a35a}
      .hd h2{font:600 15px/1.2 Georgia,"Times New Roman",serif;color:#ecd29a;letter-spacing:.02em}
      .hd .sub{color:#8f826d;font-size:11px}
      .hd .x{margin-left:auto;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:none;color:#8f826d;cursor:pointer;padding:0}
      .hd .x:hover,.hd .x:focus-visible{color:#e6dccb;background:#ffffff0d;outline:none}
      .bd{padding:4px 14px 12px;overflow:auto}
      .dup{margin:10px 14px 0;padding:9px 11px;border:1px solid #9a4a3f;border-radius:8px;background:#2a1512;color:#ffb4a8;font-size:12px}
      .sec{padding-top:12px}
      .st{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;font-size:10.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#8f826d}
      .st span{font:inherit;letter-spacing:inherit}
      .st .cnt{letter-spacing:0;text-transform:none;font-weight:400}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .f label{display:block;margin-bottom:4px;color:#8f826d;font-size:11.5px}
      input[type=text],input[type=search],select{width:100%;background:#0b0907;color:#e6dccb;border:1px solid #3e3324;border-radius:7px;padding:7px 9px}
      input[type=text]:focus,input[type=search]:focus,select:focus{border-color:#c8a35a;outline:none}
      button{font-weight:500}
      .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#1f1912;color:#ecd29a;border:1px solid #5a4a32;border-radius:7px;padding:7px 11px;cursor:pointer}
      .btn:hover:not(:disabled),.btn:focus-visible{border-color:#c8a35a;outline:none}
      .btn:disabled{opacity:.45;cursor:default}
      .btn.pri{background:#3a2c14;border-color:#8a6d36;color:#f3dfb0;font-weight:600}
      .btn.sm{padding:4px 8px;font-size:12px}
      .lk{background:none;border:0;color:#8f826d;font-size:11.5px;cursor:pointer;padding:2px 4px;border-radius:4px}
      .lk:hover,.lk:focus-visible{color:#ecd29a;outline:none}
      .tools{display:flex;gap:6px;align-items:center}
      .tabs{max-height:190px;overflow:auto;border:1px solid #2b241b;border-radius:8px;background:#0d0b09;margin-top:7px}
      .tabs label{display:flex;gap:8px;align-items:center;padding:5px 9px;font-size:12.5px;cursor:pointer;border-top:1px solid #ffffff08}
      .tabs label:first-child{border-top:0}
      .tabs label:hover{background:#ffffff06}
      .tabs input{accent-color:#c8a35a;margin:0}
      .sw{width:9px;height:9px;border-radius:2px;flex:none}
      .tt{color:#6d6455;margin-left:auto;font-size:11px}
      .empty{padding:10px;color:#8f826d;font-size:12px;text-align:center}
      .chk{display:flex;gap:8px;align-items:center;padding:4px 0;color:#d8cdb9;font-size:12.5px;cursor:pointer}
      .chk input{accent-color:#c8a35a;margin:0}
      .ft{padding:12px 14px;border-top:1px solid #2b241b;background:#15110d}
      .acts{display:grid;grid-template-columns:1fr auto;gap:8px}
      .bar{height:4px;background:#0b0907;border-radius:2px;margin-top:10px;overflow:hidden}
      .bar>div{height:100%;width:0;background:#c8a35a;transition:width .2s}
      .status{margin-top:7px;color:#b5a991;font-size:12px;min-height:1.4em;white-space:pre-wrap}
      .err{color:#ff8a7a}
      .open-page{display:inline-flex;align-items:center;gap:5px;margin-top:8px;color:#c8a35a;font-size:12px;text-decoration:none}
      .open-page:hover{color:#ecd29a;text-decoration:underline}
    </style>
    <div class="panel" id="panel" role="dialog" aria-labelledby="pTitle">
      <div class="hd"><span class="ic">${ICON}</span><div><h2 id="pTitle">Coffres PoE1</h2><div class="sub">Scanner · script v${VER}</div></div>
        <button class="x" id="close" aria-label="Fermer le panneau"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="dup" id="dup" hidden role="alert"></div>
      <div class="bd">
        <div class="sec">
          <div class="st">Compte</div>
          <div class="grid">
            <div class="f"><label for="acc">Compte</label><input type="text" id="acc" placeholder="Nom#1234" autocomplete="off"></div>
            <div class="f"><label for="league">Ligue</label><select id="league"><option value="">Chargement…</option></select></div>
          </div>
        </div>
        <div class="sec">
          <div class="st"><span>Onglets <span class="cnt" id="tabCount"></span></span>
            <span class="tools"><span id="selTools" hidden><button class="lk" id="all">Tout</button><button class="lk" id="none">Rien</button></span><button class="btn sm" id="load">Charger</button></span></div>
          <div id="tabsWrap" style="display:none">
            <input type="search" id="tabQ" placeholder="Filtrer les onglets…" aria-label="Filtrer les onglets">
            <div class="tabs" id="tabs"></div>
          </div>
          <div class="empty" id="tabsHint">Charge la liste pour choisir les onglets à scanner.</div>
        </div>
        <div class="sec">
          <div class="st">Automatisation</div>
          <div class="f"><label for="auto">Rescan automatique</label>
            <select id="auto"><option value="0">Désactivé</option><option value="15">Toutes les 15 min</option><option value="30">Toutes les 30 min</option><option value="60">Toutes les heures</option></select></div>
          <label class="chk" style="margin-top:6px"><input type="checkbox" id="wc"> Importer aussi les personnages</label>
          <label class="chk"><input type="checkbox" id="dl"> Télécharger le JSON à chaque scan</label>
        </div>
      </div>
      <div class="ft">
        <div class="acts"><button class="btn pri" id="scan">Scanner maintenant</button><button class="btn" id="chars" title="Équipement et inventaire des personnages de la ligue">Personnages</button></div>
        <div class="bar"><div id="prog"></div></div>
        <div class="status" id="status" role="status"></div>
        <a class="open-page" href="https://mrpatatatomique.github.io/poe-coffres/" target="_blank" rel="noopener">Ouvrir la page des coffres ↗</a>
      </div>
    </div>
    <button class="fab" id="fab" aria-expanded="false" title="Coffres PoE1 · script v${VER}">${ICON}<span>Coffres</span><span class="v">v${VER}</span><span class="dot" id="fabDot"></span></button>`;

    const $ = id => root.getElementById(id);
    const setStatus = (msg, err = false) => { $('status').textContent = msg; $('status').className = 'status' + (err ? ' err' : ''); };
    const report = d => { if (d.msg) setStatus(d.msg, !!d.error); if (typeof d.p === 'number') $('prog').style.width = `${Math.round(d.p * 100)}%`; };
    let tabList = [];

    async function detectAccount() {
      try { const j = await ggg('/get-account-name', {}, 'POST'); if (j && j.accountName) return j.accountName; } catch (e) { logErr('détection du compte', e); }
      const a = document.querySelector('a[href*="/account/view-profile/"]');
      if (a) return decodeURIComponent(a.getAttribute('href').split('/view-profile/')[1].split(/[/?#]/)[0]).replace(/-(\d{4})$/, '#$1');
      return '';
    }

    const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `le ${new Date(t).toLocaleDateString('fr-FR')}`; };
    const fabState = () => { const last = GM_getValue('lastScanAt', 0); $('fabDot').classList.toggle('ok', Date.now() - last < 3 * 3600000); $('fab').title = `Coffres PoE1 · script v${VER}${last ? ` · dernier scan ${ago(last)}` : ''}`; };
    fabState(); setInterval(fabState, 60000);
    // une autre copie du script (autre gestionnaire de scripts, ancienne installation) ajoute son propre bouton
    setTimeout(() => {
      const others = [...document.body.children].filter(e => e !== host && e.shadowRoot && e.shadowRoot.getElementById('fab'));
      if (!others.length) return;
      const v = others.map(e => (e.shadowRoot.getElementById('fab').textContent.match(/v[\d.]+/) || ['ancienne version'])[0]);
      $('dup').hidden = false;
      $('dup').textContent = `Une autre copie de ce script est active dans ce navigateur (${v.join(', ')}). Elle a ses propres réglages et scans : supprime-la dans ton gestionnaire de scripts (Violentmonkey, Tampermonkey ou Greasemonkey), puis recharge la page.`;
      if (!$('panel').classList.contains('open')) $('fab').click();
    }, 2500);
    $('close').onclick = () => $('fab').click();
    root.addEventListener('keydown', e => { if (e.key === 'Escape' && $('panel').classList.contains('open')) $('fab').click(); });
    $('fab').onclick = async () => {
      const p = $('panel');
      p.classList.toggle('open');
      $('fab').setAttribute('aria-expanded', String(p.classList.contains('open')));
      if (!p.classList.contains('open') || $('acc').dataset.init) return;
      $('acc').dataset.init = '1';
      const st = getSettings();
      $('acc').value = st.account || '';
      const fillLeagues = (list, cur) => {
        const all = [...new Set([...(cur ? [cur] : []), ...list])];
        $('league').innerHTML = all.length ? all.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('') : '<option value="">Aucune ligue trouvée</option>';
        if (cur) $('league').value = cur;
      };
      fillLeagues([], st.league || '');
      $('auto').value = String(st.autoMinutes || 0);
      $('dl').checked = !!st.alsoDownload;
      $('wc').checked = !!st.withChars;
      if (!$('acc').value) { setStatus('Détection du compte…'); $('acc').value = await detectAccount(); $('acc').placeholder = 'Nom#1234'; }
      if ($('acc').value) {
        try {
          const chars = await ggg('/get-characters', { accountName: $('acc').value.trim(), realm: REALM });
          // ligues où le compte a des personnages : ligues en cours d'abord, Standard et Hardcore à la fin
          const leagues = [...new Set((chars || []).map(c => c.league).filter(Boolean))].sort((a, b) => /standard|hardcore/i.test(a) - /standard|hardcore/i.test(b));
          fillLeagues(leagues, st.league || leagues[0] || '');
          if (!st.league && $('league').value) saveForm();
        } catch (e) { logErr('liste des ligues', e); }
      }
      const last = GM_getValue('lastScanAt', 0);
      setStatus(last ? `Dernier scan ${ago(last)}.` : 'Charge les onglets puis lance un premier scan.');
      const sel = st.selected?.[st.league];
      $('tabCount').textContent = sel ? `· ${sel.length} choisis` : '';
    };

    const saveForm = () => setSettings({ account: $('acc').value.trim(), league: $('league').value.trim() });
    // changer de ligue : on enregistre tout de suite et on recharge la liste des onglets de cette ligue
    $('league').onchange = () => { saveForm(); $('tabsWrap').style.display = 'none'; $('tabsHint').hidden = false; $('selTools').hidden = true; $('load').textContent = 'Charger'; $('tabCount').textContent = ''; setStatus(`Ligue : ${$('league').value}. Charge les onglets puis lance un scan.`); };
    $('auto').onchange = () => setSettings({ autoMinutes: Number($('auto').value) });
    $('dl').onchange = () => setSettings({ alsoDownload: $('dl').checked });
    $('wc').onchange = () => setSettings({ withChars: $('wc').checked });
    $('tabQ').oninput = () => { const q = $('tabQ').value.trim().toLowerCase(); root.querySelectorAll('#tabs label').forEach(l => (l.hidden = q && !l.textContent.toLowerCase().includes(q))); };

    $('load').onclick = async () => {
      saveForm();
      const { account, league } = getSettings();
      if (!account || !league) return setStatus('Compte et ligue requis.', true);
      $('load').disabled = true;
      setStatus('Lecture de la liste des onglets…');
      try {
        const j = await ggg('/get-stash-items', { accountName: account, realm: REALM, league, tabs: 1, tabIndex: 0 });
        tabList = flattenTabs(j.tabs);
        const sel = new Set(getSettings().selected?.[league] || tabList.map(t => t.i));
        $('tabs').innerHTML = tabList.map(t => {
          const c = t.colour ? `rgb(${t.colour.r},${t.colour.g},${t.colour.b})` : '#555';
          return `<label><input type="checkbox" data-i="${t.i}" ${sel.has(t.i) ? 'checked' : ''}><span class="sw" style="background:${c}"></span>${esc(t.n)}<span class="tt">${esc(t.type || '')}</span></label>`;
        }).join('');
        $('tabsWrap').style.display = ''; $('tabsHint').hidden = true; $('selTools').hidden = false; $('load').textContent = 'Recharger';
        root.querySelectorAll('#tabs input').forEach(c => c.onchange = saveSelection);
        saveSelection();
        setStatus(`${tabList.length} onglets trouvés. Décoche ceux à ignorer.`);
      } catch (e) { setStatus(e.message, true); }
      $('load').disabled = false;
    };
    function saveSelection() {
      const league = getSettings().league;
      const chosen = [...root.querySelectorAll('#tabs input:checked')].map(c => Number(c.dataset.i));
      setSettings({ selected: { ...(getSettings().selected || {}), [league]: chosen } });
      $('tabCount').textContent = `· ${chosen.length} / ${tabList.length || chosen.length}`;
    }
    $('all').onclick = () => { root.querySelectorAll('#tabs input').forEach(c => (c.checked = true)); saveSelection(); };
    $('none').onclick = () => { root.querySelectorAll('#tabs input').forEach(c => (c.checked = false)); saveSelection(); };

    const doChars = async (league, rep = report) => {
      $('chars').disabled = true;
      try { await runChars(rep, league); } catch (e) { rep({ msg: `Personnages : ${e.message}`, error: true }); }
      $('chars').disabled = false;
    };
    $('chars').onclick = () => { saveForm(); doChars(''); };
    // demandes venues de la page : exécutées ici (cookies et Cloudflare OK), progression publiée dans gggStatus
    GM_addValueChangeListener('gggRequest', async (k, o, n, remote) => {
      if (!remote || !n || Date.now() - n.at > 60000) return;
      const lk = GM_getValue('gggLock', null);
      if (lk && lk.id !== n.id && lk.until > Date.now()) return; // un autre onglet GGG traite déjà une demande
      GM_setValue('gggLock', { id: n.id, until: Date.now() + 60000 });
      if (GM_getValue('gggLock', null).id !== n.id) return;
      const relay = d => {
        report(d);
        GM_setValue('gggLock', { id: n.id, until: Date.now() + 60000 });
        GM_setValue('gggStatus', { id: n.id, msg: d.msg || '', p: d.p, error: !!d.error, done: false, at: Date.now() });
      };
      relay({ msg: n.kind === 'scan' ? 'Scan pris en charge par l\'onglet pathofexile.com…' : 'Personnages : pris en charge par l\'onglet pathofexile.com…' });
      let ok = true, last = '';
      try {
        if (n.kind === 'scan') {
          $('scan').disabled = $('load').disabled = true;
          const scan = await runScan(relay);
          last = `Scan terminé : ${scan.items.length} objets.`;
          if (getSettings().withChars) { await runChars(relay); last += ' Personnages importés.'; }
        } else {
          $('chars').disabled = true;
          const out = await runChars(relay, (n.data && n.data.league) || '');
          last = `Personnages : ${out.chars.length} importé${out.chars.length > 1 ? 's' : ''}.`;
        }
      } catch (e) { ok = false; last = `${n.kind === 'scan' ? 'Scan' : 'Personnages'} : ${e.message}`; }
      $('scan').disabled = $('load').disabled = $('chars').disabled = false;
      report({ msg: last, error: !ok, p: 1 });
      GM_setValue('gggStatus', { id: n.id, msg: last, p: 1, error: !ok, done: ok, at: Date.now() });
      GM_setValue('gggLock', null);
      fabState();
    });
    $('scan').onclick = async () => {
      saveForm();
      $('scan').disabled = $('load').disabled = true;
      try {
        const scan = await runScan(report);
        if (getSettings().alsoDownload) download(scan);
        if (getSettings().withChars) await doChars('');
        if (!getSettings().ninjaRemote) loadPrices(false, () => {}).catch(e => logErr('prix poe.ninja après scan', e));
      } catch (e) { setStatus(e.message, true); }
      $('scan').disabled = $('load').disabled = false;
      fabState();
    };

    function download(scan) {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(scan)], { type: 'application/json' }));
      a.download = `coffres_${scan.league.replace(/[^\w-]+/g, '_')}_${stamp}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    setInterval(() => autoTick(report), 60000);
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
})();
