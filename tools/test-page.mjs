// Test de bout en bout de coffres-poe1.html dans un vrai navigateur (Playwright + Chromium).
// Usage : node tools/test-page.mjs            (CHROME_PATH=/chemin/chrome pour utiliser un Chrome installé)
// Construit un faux site GitHub Pages (page + data/ à partir de tools/fixtures), le sert en local,
// charge un scan d'exemple puis vérifie prix, totaux, fenêtres, prix manuel, personnages et garde-fous.
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { ok, equal } from 'node:assert/strict';
import { chromium } from 'playwright';
import { PoeNinja as N } from './ninja.mjs';
import { encodeShard, shardOf } from './update-data.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const FX = JSON.parse(readFileSync(join(ROOT, 'tools/fixtures/ninja.json'), 'utf8'));
const SCAN = readFileSync(join(ROOT, 'tools/fixtures/scan.json'), 'utf8');
const CHARS = readFileSync(join(ROOT, 'tools/fixtures/chars.json'), 'utf8');
const NOW = Date.now();

// ---------------------------------------------------------------- faux site
function prices(league, scale = 1) {
  const sc = lines => lines.map(l => ({ ...l, v: Math.round(l.v * scale * 100) / 100 }));
  const ex = N.exchangeLines(FX.exchange), cu = N.currencyLines(FX.currency);
  return {
    league, fetchedAt: NOW - 5 * 60000, core: ex.core, tradeIds: cu.tradeIds, stale: [],
    exchange: { Currency: sc(ex.lines) }, currency: { Currency: sc(cu.lines) },
    items: { UniqueAccessory: sc(N.itemLines('UniqueAccessory', FX.uniques).lines), SkillGem: sc(N.itemLines('SkillGem', FX.gems).lines) },
  };
}
function buildSite({ archived = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'coffres-test-'));
  const w = (p, o) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), typeof o === 'string' ? o : JSON.stringify(o)); };
  copyFileSync(join(ROOT, 'coffres-poe1.html'), join(dir, 'coffres-poe1.html'));
  const extra = { league: 'Covens', fetchedAt: NOW - 5 * 60000, items: {
    BaseType: N.itemLines('BaseType', FX.bases).lines, ClusterJewel: N.itemLines('ClusterJewel', FX.clusters).lines } };
  // historique : la Divine passe de 150 à 168,7 c sur 2 jours (un point toutes les 30 min)
  const hist = {}, recent = {};
  const pts = [];
  for (let m = 2 * 1440; m >= 0; m -= 30) pts.push([Math.floor((NOW - 5 * 60000) / 60000) - m, Math.round((168.7 - (18.7 * m) / 2880) * 100) / 100]);
  for (const [k, p] of [['x|divine', pts]]) {
    const sh = shardOf(k);
    (hist[sh] ||= {})[k] = p; (recent[sh] ||= {})[k] = p;
  }
  const base = archived ? 'data/archive/Covens' : null;
  if (archived) {
    w('data/leagues.json', { leagues: [{ id: 'Settlers', name: 'Settlers', file: 'Settlers' }], archived: [{ id: 'Covens', name: 'Covens', file: 'Covens', endedAt: NOW }], shards: 64 });
    w(`${base}/prices.json`, prices('Covens'));
    w(`${base}/prices-extra.json`, extra);
    for (const [sh, h] of Object.entries(hist)) w(`${base}/history/${sh}.json`, encodeShard(h));
  } else {
    w('data/leagues.json', { leagues: [{ id: 'Covens', name: 'Covens', file: 'Covens' }, { id: 'Hardcore Covens', name: 'Hardcore Covens', file: 'Hardcore_Covens' }], shards: 64 });
    w('data/prices/Covens.json', prices('Covens'));
    w('data/prices/Hardcore_Covens.json', prices('Hardcore Covens', 10));
    w('data/prices-extra/Covens.json', extra);
    w('data/icons/Covens.json', {});
    for (const [sh, h] of Object.entries(hist)) w(`data/history/Covens/${sh}.json`, encodeShard(h));
    for (const [sh, h] of Object.entries(recent)) w(`data/history-recent/Covens/${sh}.json`, encodeShard(h));
  }
  return dir;
}
function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
  const hits = [];
  const srv = createServer((req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    hits.push(p);
    try { const body = readFileSync(join(dir, p)); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, hits, url: `http://127.0.0.1:${srv.address().port}/coffres-poe1.html` })));
}

// ---------------------------------------------------------------- outils
const num = s => Number(String(s).replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'));
const REQ = (readFileSync(join(ROOT, 'coffres-poe1.html'), 'utf8').match(/REQ_SCRIPT = '([^']+)'/) || [])[1];

async function openPage(browser, site, { script = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(`console: ${m.text()}`); });
  // faux script Violentmonkey : la page lui parle par postMessage
  await page.addInitScript(() => { window.__cmds = []; window.addEventListener('message', e => { try { const m = JSON.parse(e.data); if (m.src === 'poe-viewer') window.__cmds.push(m); } catch {} }); });
  await page.goto(site.url);
  if (script) await post(page, 'ready', { version: REQ, inst: 'test' });
  await page.setInputFiles('#file', { name: 'scan.json', mimeType: 'application/json', buffer: Buffer.from(SCAN) });
  await page.waitForFunction(() => /chaos/.test(document.getElementById('kTotalSub').textContent), null, { timeout: 10000 });
  await page.waitForTimeout(800);
  return { page, errors };
}
const post = (page, type, data) => page.evaluate(([type, data]) => window.postMessage(JSON.stringify({ src: 'poe-us', type, data }), '*'), [type, data]);
const rowText = (page, name) => page.evaluate(n => [...document.querySelectorAll('tr.it')].map(r => r.innerText.replace(/\s+/g, ' ')).find(t => t.includes(n)) || '', name);
const filterList = async (page, q) => { await page.fill('#q', q); await page.waitForTimeout(250); };

// ---------------------------------------------------------------- tests
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
let ctx;

test('chargement sans erreur JavaScript', async () => {
  equal(ctx.errors.length, 0, ctx.errors.join('\n'));
});
test('total du coffre = somme des prix poe.ninja (équipement à part)', async () => {
  // 3 × 168,7 + 10 × 2,15 + 50 × 1 + Headhunter 9000 + Bladefall niveau 1 15
  const expected = 3 * 168.7 + 10 * 2.15 + 50 + 9000 + 15;
  const shown = num(await ctx.page.textContent('#kTotalSub'));
  ok(Math.abs(shown - expected) <= 1, `affiché ${shown} c, attendu ${expected} c`);
});
test('gemme : la variante de niveau 1 (15 c), pas la 1/20 corrompue (168 c)', async () => {
  await filterList(ctx.page, 'Bladefall');
  const t = await rowText(ctx.page, 'Bladefall');
  ok(/15,0 c|15 c/.test(t) && !/168/.test(t), t);
});
test('valeur de la base : joyau cluster et bottes influencées, pas l\'anneau à moins de 5 c', async () => {
  await filterList(ctx.page, 'Cluster');
  ok(/base 1,5 div/.test(await rowText(ctx.page, 'Cluster')), await rowText(ctx.page, 'Cluster')); // 250 c
  await filterList(ctx.page, 'Doom Stride');
  ok(/base/.test(await rowText(ctx.page, 'Doom Stride')), await rowText(ctx.page, 'Doom Stride'));
  await filterList(ctx.page, 'Loath Loop');
  ok(!/base/.test(await rowText(ctx.page, 'Loath Loop')), await rowText(ctx.page, 'Loath Loop'));
  await filterList(ctx.page, '');
});
test('fichier des prix annexes chargé une seule fois (pas de boucle)', async () => {
  await ctx.page.waitForTimeout(1500);
  const n = ctx.site.hits.filter(h => h.includes('prices-extra')).length;
  ok(n >= 1 && n <= 2, `${n} chargements`);
});
test('fenêtre de prix : variations calculées depuis l\'historique', async () => {
  await filterList(ctx.page, 'Divine');
  await ctx.page.click('tr.it .loupe');
  await ctx.page.waitForSelector('#zModal:not([hidden])');
  await ctx.page.waitForTimeout(800);
  const txt = await ctx.page.textContent('#zBox');
  ok(/Variation 24 h/i.test(txt) && /▲/.test(txt), txt.slice(0, 300));
  ok(/Prix min/i.test(txt) && /150/.test(txt), 'prix min 150 c attendu');
  await ctx.page.keyboard.press('Escape');
  ok(await ctx.page.evaluate(() => document.getElementById('zModal').hidden), 'Échap ferme la fenêtre');
  await filterList(ctx.page, '');
});
test('prix manuel : crayon, 2 div, badge MANUEL, compté dans les estimations', async () => {
  const p = ctx.page;
  await filterList(p, 'Doom Stride');
  await p.click('tr.it');
  await p.click('#detailBody [data-pen]:visible');
  await p.fill('#mpV', '2');
  await p.click('#manBox [data-u="div"]');
  await p.click('#mpSave');
  await p.waitForTimeout(400);
  ok(/manuel/i.test(await rowText(p, 'Doom Stride')), await rowText(p, 'Doom Stride'));
  ok(/2,0 div/.test(await p.textContent('#kTrade')), `estimations : ${await p.textContent('#kTrade')}`);
  await filterList(p, '');
});
test('surveillés : recherche d\'une base influencée et ajout', async () => {
  const p = ctx.page;
  await p.click('#watchAdd');
  await p.selectOption('#wCat', 'base');
  await p.fill('#wQ', 'velour');
  await p.waitForSelector('#wRes .wit');
  await p.click('#wRes [data-w="0"]');
  await p.keyboard.press('Escape');
  ok(/Velour Boots \(Redeemer\/Hunter, ilvl 85\)/.test(await p.textContent('#watchList')), await p.textContent('#watchList'));
});
test('personnages : valeur à part, vue équipement complète même avec un filtre actif', async () => {
  const p = ctx.page;
  const before = await p.textContent('#kTotal');
  await post(p, 'chars', CHARS);
  await p.waitForSelector('#charList .chartab');
  equal(await p.textContent('#kTotal'), before, 'le total du coffre ne bouge pas');
  await p.click('label:has(#priced)'); // filtre « Cotés » actif
  await p.click('#charList .chartab');
  await p.click('#vGrid');
  await p.waitForSelector('.doll');
  const slots = await p.$$eval('.dslot[data-i]', els => els.map(e => e.getAttribute('aria-label')));
  for (const s of ['Ceinture', 'Anneau gauche', 'Armure', 'Flasque 1']) ok(slots.some(x => x.startsWith(s)), `${s} absent : ${slots.join(', ')}`);
  await p.hover('.dslot[aria-label^="Armure"]');
  ok(!(await p.isHidden('#hoverCard')) && /Bladefall/.test(await p.textContent('#hoverCard')), 'carte au survol avec la gemme sertie');
  await p.click('label:has(#priced)');
  await p.click('#vList');
});
test('prix d\'une autre ligue envoyés par le script : ignorés', async () => {
  const p = ctx.page;
  const before = await p.textContent('#kTotal');
  const hc = { ...prices('Hardcore Covens', 10), fetchedAt: NOW + 60000, gggLeague: 'Covens' };
  await post(p, 'prices', JSON.stringify(hc));
  await p.waitForTimeout(800);
  equal(await p.textContent('#kTotal'), before);
});
test('gains : fenêtre détaillée ouverte et refermée', async () => {
  const p = ctx.page;
  await p.click('#ghMore');
  await p.waitForSelector('#gModal:not([hidden]) #gTitle');
  await p.keyboard.press('Escape');
  ok(await p.evaluate(() => document.getElementById('gModal').hidden));
});
test('import des personnages : commande envoyée au script, délai géré', async () => {
  const p = ctx.page;
  await p.click('#charsImp');
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.__cmds.some(c => c.cmd === 'chars' && c.data && c.data.league === 'Covens')), `commande chars avec la ligue — message : ${await p.textContent('#toastMsg')} — ${JSON.stringify(await p.evaluate(() => window.__cmds.map(c => c.cmd)))}`);
});
test('historique des erreurs : une erreur du script y est enregistrée', async () => {
  const p = ctx.page;
  await post(p, 'status', { msg: 'Personnages : erreur de test', error: true });
  await p.click('#acctBtn');
  await p.click('#errBtn');
  ok(/erreur de test/.test(await p.textContent('#eList')));
  await p.keyboard.press('Escape');
});
test('aucune erreur JavaScript pendant les tests', async () => {
  equal(ctx.errors.length, 0, ctx.errors.join('\n'));
});
test('ligue terminée : prix archivés utilisés', async () => {
  const site = await serve(buildSite({ archived: true }));
  try {
    const { page, errors } = await openPage(ctx.browser, site);
    ok(Math.abs(num(await page.textContent('#kTotalSub')) - (3 * 168.7 + 10 * 2.15 + 50 + 9000 + 15)) <= 1);
    ok(/figés/.test(await page.textContent('#kPrices')), await page.textContent('#kPrices'));
    equal(errors.length, 0, errors.join('\n'));
    await page.close();
  } finally { site.srv.close(); }
});

// ---------------------------------------------------------------- lancement
const dir = buildSite();
const site = await serve(dir);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let fail = 0;
try {
  ctx = { browser, site, ...(await openPage(browser, site)) };
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok   ${name}`); }
    catch (e) {
      fail++;
      console.log(`ÉCHEC ${name}\n     ${String(e.message).split('\n').slice(0, 3).join('\n     ')}`);
      await ctx.page.keyboard.press('Escape').catch(() => {});
    }
  }
} finally {
  if (fail && ctx) await ctx.page.screenshot({ path: join(tmpdir(), 'coffres-test-echec.png') }).catch(() => {});
  await browser.close(); site.srv.close(); rmSync(dir, { recursive: true, force: true });
}
console.log(`${tests.length - fail}/${tests.length} tests réussis${fail ? ` (capture : ${join(tmpdir(), 'coffres-test-echec.png')})` : ''}`);
process.exit(fail ? 1 : 0);
