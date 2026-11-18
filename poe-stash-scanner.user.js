// ==UserScript==
// @name         PoE1 – Scanner de coffres
// @namespace    https://github.com/MrPatatatomique/poe-coffres
// @author       MrPatatatomique
// @homepageURL  https://github.com/MrPatatatomique/poe-coffres
// @supportURL   https://github.com/MrPatatatomique/poe-coffres/issues
// @updateURL    https://mrpatatatomique.github.io/poe-coffres/poe-stash-scanner.user.js
// @downloadURL  https://mrpatatatomique.github.io/poe-coffres/poe-stash-scanner.user.js
// @version      2.6.6
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

  // ---------- Scan complet (utilisé par le panneau GGG et par la page) ----------
  let scanning = false;
  async function runScan(report = () => {}, { tabsOverride } = {}) {
    const st = getSettings();
    const account = st.account, league = st.league;
    if (!account || !league) throw new Error('Compte et ligue inconnus : fais un premier scan depuis pathofexile.com (bouton Coffres).');
    const lock = GM_getValue('scanLock', 0);
    if (scanning || lock > Date.now()) throw new Error('Un scan est déjà en cours.');
    scanning = true;
    GM_setValue('scanLock', Date.now() + 15 * 60 * 1000);
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
  const EXCHANGE_TYPES = ['Currency', 'Fragment', 'Runegraft', 'AllflameEmber', 'Tattoo', 'Omen', 'DjinnCoin', 'Ducat', 'EnshroudingCrystal', 'DivinationCard', 'Artifact', 'Oil', 'DeliriumOrb', 'Scarab', 'Astrolabe', 'Thread', 'Fossil', 'Resonator', 'Essence'];
  const STASH_CURRENCY_TYPES = ['Currency', 'Fragment'];
  const ITEM_TYPES = ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel', 'UniqueTincture', 'UniqueRelic', 'UniqueMap', 'SkillGem', 'Map', 'BlightedMap', 'BlightRavagedMap', 'ValdoMap', 'Invitation', 'Memory', 'Incubator', 'Vial', 'Wombgift', 'Corpse', 'Viscera'];

  async function ninjaGet(path) {
    const res = await http(NINJA + path);
    if (res.status !== 200) throw new Error(`poe.ninja HTTP ${res.status}`);
    return JSON.parse(res.text);
  }

  function pickNinjaLeague(leagues, gggLeague) {
    const g = (gggLeague || '').toLowerCase();
    const exact = leagues.find(l => l.id.toLowerCase() === g || (l.name || '').toLowerCase() === g);
    if (exact) return exact.id;
    if (!g) throw new Error('ligue inconnue (aucun scan enregistré).');
    // ligue GGG plus longue que l'id poe.ninja, même mode (softcore / hardcore) ; jamais une ligue au hasard
    const hc = /hardcore|\bhc\b/.test(g);
    const pref = leagues.filter(l => g.startsWith(l.id.toLowerCase()) && /hardcore/i.test(l.id) === hc).sort((a, b) => b.id.length - a.id.length);
    if (!pref.length) throw new Error(`Ligue « ${gggLeague} » introuvable sur poe.ninja.`);
    return pref[0].id;
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
        const j = await ninjaGet(`/exchange/current/overview${q(t)}`);
        const names = new Map((j.items || []).map(i => [i.id, i.name]));
        out.exchange[t] = (j.lines || []).map(l => ({ k: `x|${l.id}`, name: names.get(l.id), v: l.primaryValue, sp: l.sparkline?.data })).filter(l => l.name);
        if (t === 'Currency') out.core = j.core ? { primary: j.core.primary, rates: j.core.rates } : null;
      } catch (e) { logErr(`poe.ninja ${t} (exchange)`, e); }
      await sleep(150);
    }
    for (const t of STASH_CURRENCY_TYPES) {
      report({ msg: `poe.ninja : ${t} (${++n}/${total})` });
      try {
        const j = await ninjaGet(`/stash/current/currency/overview${q(t)}`);
        out.currency[t] = (j.lines || []).map(l => ({ k: `c|${l.detailsId}`, name: l.currencyTypeName, v: l.chaosEquivalent, sp: l.receiveSparkLine?.data }));
        const tid = new Map((j.currencyDetails || []).map(d => [d.name, d.tradeId]));
        for (const l of j.lines || []) { const t2 = tid.get(l.currencyTypeName); if (t2 && l.chaosEquivalent > 0) out.tradeIds[t2] = l.chaosEquivalent; }
      } catch (e) { logErr(`poe.ninja ${t} (currency)`, e); }
      await sleep(150);
    }
    for (const t of ITEM_TYPES) {
      report({ msg: `poe.ninja : ${t} (${++n}/${total})` });
      try {
        const j = await ninjaGet(`/stash/current/item/overview${q(t)}`);
        out.items[t] = (j.lines || []).map(l => ({
          k: `i|${t}|${l.detailsId}|${l.links || 0}`,
          name: l.name, baseType: l.baseType, variant: l.variant, links: l.links || 0,
          gemLevel: l.gemLevel, gemQuality: l.gemQuality || 0, corrupted: !!l.corrupted,
          mapTier: l.mapTier, itemClass: l.itemClass, v: l.chaosValue, listings: l.listingCount,
          sp: (l.sparkLine?.data || []).some(x => x !== null) ? l.sparkLine.data : l.lowConfidenceSparkLine?.data,
          ...(/^Unique/.test(t) ? { ranges: (l.explicitModifiers || []).map(m => m.text).filter(x => /\(-?[\d.]+-/.test(x)), iranges: (l.implicitModifiers || []).map(m => m.text).filter(x => /\(-?[\d.]+-/.test(x)) } : {}),
        }));
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
    if (!mins || scanning) return;
    const last = GM_getValue('lastScanAt', 0);
    if (Date.now() - last < mins * 60000) return;
    if (GM_getValue('scanLock', 0) > Date.now()) return;
    // Si la page n'a pas les cookies GGG, on laisse l'onglet pathofexile.com s'en charger pendant 1 h
    if (!ON_GGG && Date.now() - GM_getValue('authFailedAt', 0) < 3600000) return;
    try { await runScan(report); } catch (e) { report({ msg: `Rescan auto : ${e.message}`, error: true }); }
  }

  if (ON_GGG) gggPanel(); else viewerBridge();

  // =====================================================================
  // Pont avec la page coffres-poe1.html
  // =====================================================================
  function viewerBridge() {
    const send = (type, data) => window.postMessage(JSON.stringify({ src: 'poe-us', type, data }), '*');
    const report = d => send('status', d);
    const pushScan = () => { const s = GM_getValue('lastScan', null); if (s) send('scan', s); };
    const pushPrices = p => p && send('prices', JSON.stringify(p));
    const pushSettings = () => send('settings', getSettings());
    const pushTrades = () => send('trades', JSON.stringify(GM_getValue('tradeEstimates', {})));
    let tradeQueue = Promise.resolve(), tradeQueued = 0;
    const pushTracking = () => send('tracking', JSON.stringify({ follow: GM_getValue('follow', {}), history: GM_getValue('priceHistory', {}) }));

    let greeted = false;
    async function greet() {
      if (greeted) return;
      greeted = true;
      send('ready', { version: '2.6.6' });
      pushSettings(); pushTracking(); pushTrades(); pushScan();
      const p = GM_getValue('ninjaPrices', null);
      if (p) pushPrices(p);
      if (!getSettings().ninjaRemote && (!p || Date.now() - p.fetchedAt > NINJA_TTL || p.gggLeague !== getSettings().league)) pushPrices(await loadPrices(false, report));
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
          await runScan(report);
          pushScan();
          if (!getSettings().ninjaRemote) pushPrices(await loadPrices(false, report));
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
    GM_addValueChangeListener('ninjaPrices', (k, o, n, remote) => { if (remote && n) pushPrices(n); });

    // Le script se charge après la page : on se présente tout de suite, sans attendre son "hello"
    greet().catch(e => report({ msg: e.message, error: true }));

    // Rafraîchissement des prix indépendant du scan, tant que la page est ouverte
    let pricesBusy = false;
    setInterval(async () => {
      const p = GM_getValue('ninjaPrices', null);
      if (getSettings().ninjaRemote || pricesBusy || (p && p.gggLeague === getSettings().league && Date.now() - p.fetchedAt < NINJA_TTL)) return;
      pricesBusy = true;
      try { pushPrices(await loadPrices(false, () => {})); }
      catch (e) { report({ msg: `Prix poe.ninja : ${e.message}`, error: true }); }
      finally { pricesBusy = false; }
    }, 60000);

    setInterval(() => autoTick(d => { report(d); if (d.done) { pushScan(); if (!getSettings().ninjaRemote) loadPrices(false, report).then(pushPrices).catch(e => logErr('prix poe.ninja après rescan auto', e)); } }), 60000);
  }

  // =====================================================================
  // Panneau sur pathofexile.com (premier réglage + scan manuel)
  // =====================================================================
  function gggPanel() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
    <style>
      :host{all:initial}
      *{box-sizing:border-box;font:13px/1.4 system-ui,sans-serif}
      .fab{background:#1b1712;color:#e8c98a;border:1px solid #6b5530;border-radius:8px;padding:8px 12px;cursor:pointer}
      .fab:hover{border-color:#e8c98a}
      .panel{display:none;width:360px;max-height:75vh;overflow:auto;background:#14110d;color:#ddd;border:1px solid #6b5530;border-radius:10px;padding:14px;margin-bottom:8px;box-shadow:0 8px 30px #000a}
      .panel.open{display:block}
      h2{margin:0 0 10px;font-size:15px;color:#e8c98a}
      label{display:block;margin:8px 0 3px;color:#aaa;font-size:12px}
      input,select{width:100%;background:#0c0a08;color:#eee;border:1px solid #3d3326;border-radius:6px;padding:6px 8px}
      button{background:#2a2219;color:#e8c98a;border:1px solid #6b5530;border-radius:6px;padding:6px 10px;cursor:pointer}
      button:hover:not(:disabled){border-color:#e8c98a}
      button:disabled{opacity:.45;cursor:default}
      .row{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center}
      .tabs{margin-top:8px;max-height:200px;overflow:auto;border:1px solid #3d3326;border-radius:6px;padding:4px}
      .tabs label,.chk{display:flex;gap:6px;align-items:center;margin:0;padding:2px 4px;color:#ddd;font-size:12px;cursor:pointer}
      .tabs input,.chk input{width:auto}
      .sw{width:10px;height:10px;border-radius:2px;flex:none}
      .tt{color:#777;margin-left:auto;font-size:11px}
      .bar{height:6px;background:#0c0a08;border-radius:3px;margin-top:10px;overflow:hidden}
      .bar>div{height:100%;width:0;background:#c9a24f;transition:width .2s}
      .status{margin-top:6px;color:#bbb;font-size:12px;min-height:1.4em;white-space:pre-wrap}
      .err{color:#ff8a7a}
      .hint{color:#888;font-size:11px;margin-top:8px}
    </style>
    <div class="panel" id="panel">
      <h2>Scanner de coffres PoE1</h2>
      <label for="acc">Compte (Nom#1234)</label>
      <input id="acc" placeholder="Détection…">
      <label for="league">Ligue</label>
      <input id="league" list="leagues" placeholder="Standard">
      <datalist id="leagues"></datalist>
      <div class="row"><button id="load">Charger les onglets</button></div>
      <div id="tabsWrap" style="display:none">
        <div class="row"><button id="all">Tout</button><button id="none">Rien</button></div>
        <div class="tabs" id="tabs"></div>
      </div>
      <label for="auto">Rescan automatique</label>
      <select id="auto">
        <option value="0">Désactivé</option><option value="15">Toutes les 15 min</option>
        <option value="30">Toutes les 30 min</option><option value="60">Toutes les heures</option>
      </select>
      <div class="row">
        <button id="scan">Scanner maintenant</button>
        <label class="chk"><input type="checkbox" id="dl"> Télécharger aussi le JSON</label>
      </div>
      <div class="bar"><div id="prog"></div></div>
      <div class="status" id="status"></div>
      <div class="hint">Le scan est enregistré dans Violentmonkey : la page coffres-poe1.html le récupère toute seule.</div>
    </div>
    <button class="fab" id="fab">Coffres</button>`;

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

    $('fab').onclick = async () => {
      const p = $('panel');
      p.classList.toggle('open');
      if (!p.classList.contains('open') || $('acc').dataset.init) return;
      $('acc').dataset.init = '1';
      const st = getSettings();
      $('acc').value = st.account || '';
      $('league').value = st.league || '';
      $('auto').value = String(st.autoMinutes || 0);
      $('dl').checked = !!st.alsoDownload;
      if (!$('acc').value) { setStatus('Détection du compte…'); $('acc').value = await detectAccount(); $('acc').placeholder = 'Nom#1234'; }
      if ($('acc').value) {
        try {
          const chars = await ggg('/get-characters', { accountName: $('acc').value.trim(), realm: REALM });
          const leagues = [...new Set((chars || []).map(c => c.league).filter(Boolean))];
          $('leagues').innerHTML = leagues.map(l => `<option value="${esc(l)}">`).join('');
          if (!$('league').value && leagues.length) $('league').value = leagues.find(l => !/standard|hardcore/i.test(l)) || leagues[0];
        } catch (e) { logErr('liste des ligues', e); }
      }
      const last = GM_getValue('lastScanAt', 0);
      setStatus(last ? `Dernier scan : ${new Date(last).toLocaleString('fr-FR')}` : 'Charge les onglets puis lance un premier scan.');
    };

    const saveForm = () => setSettings({ account: $('acc').value.trim(), league: $('league').value.trim() });
    $('auto').onchange = () => setSettings({ autoMinutes: Number($('auto').value) });
    $('dl').onchange = () => setSettings({ alsoDownload: $('dl').checked });

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
        $('tabsWrap').style.display = '';
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
    }
    $('all').onclick = () => { root.querySelectorAll('#tabs input').forEach(c => (c.checked = true)); saveSelection(); };
    $('none').onclick = () => { root.querySelectorAll('#tabs input').forEach(c => (c.checked = false)); saveSelection(); };

    $('scan').onclick = async () => {
      saveForm();
      $('scan').disabled = $('load').disabled = true;
      try {
        const scan = await runScan(report);
        if (getSettings().alsoDownload) download(scan);
        if (!getSettings().ninjaRemote) loadPrices(false, () => {}).catch(e => logErr('prix poe.ninja après scan', e));
      } catch (e) { setStatus(e.message, true); }
      $('scan').disabled = $('load').disabled = false;
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
