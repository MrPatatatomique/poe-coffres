// Test de bout en bout de coffres-poe2.html dans un vrai navigateur (Playwright + Chromium).
// Usage : node tools/test-page2.mjs            (CHROME_PATH=/chemin/chrome pour utiliser un Chrome installé)
// Faux site : prix PoE2 construits depuis tools/fixtures/ninja2.json, historique de l'Exalted Orb, ventes d'exemple.
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { ok, equal } from 'node:assert/strict';
import { chromium } from 'playwright';
import { fetchLeague2 } from './update-poe2.mjs';
import { encodeShard, shardOf } from './update-data.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const FX = JSON.parse(readFileSync(join(ROOT, 'tools/fixtures/ninja2.json'), 'utf8'));
const LISTED = readFileSync(join(ROOT, 'tools/fixtures/listed2.json'), 'utf8');
const NOW = Date.now();
const LG = 'Forbidden Rites';
const REQ = (readFileSync(join(ROOT, 'coffres-poe2.html'), 'utf8').match(/REQ_SCRIPT = '([^']+)'/) || [])[1];

async function buildSite() {
  const dir = mkdtempSync(join(tmpdir(), 'coffres2-test-'));
  const w = (p, o) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), typeof o === 'string' ? o : JSON.stringify(o)); };
  copyFileSync(join(ROOT, 'coffres-poe2.html'), join(dir, 'coffres-poe2.html'));
  const fx = u => { const t = new URL(u).searchParams.get('type'); return (u.includes('/exchange/') ? FX.exchange[t] : FX.items[t]) || null; };
  const p = await fetchLeague2(LG, null, async u => fx(u));
  p.fetchedAt = NOW - 20 * 60000;
  w('data/poe2/leagues.json', { leagues: [{ id: LG, name: LG, file: 'Forbidden_Rites' }, { id: 'Standard', name: 'Standard', file: 'Standard' }] });
  w('data/poe2/prices/Forbidden_Rites.json', p);
  w('data/poe2/icons/Forbidden_Rites.json', p.icons);
  // historique : l'Exalted Orb passe de 0,0020 à 0,00212 div sur 3 jours (un point par heure)
  const pts = [];
  for (let h = 72; h >= 0; h--) pts.push([Math.floor((NOW - 20 * 60000) / 60000) - h * 60, Number((0.00212 - (0.00012 * h) / 72).toPrecision(4))]);
  const sh = shardOf('x|exalted');
  w(`data/poe2/history-recent/Forbidden_Rites/${sh}.json`, encodeShard({ 'x|exalted': pts }));
  w(`data/poe2/history/Forbidden_Rites/${sh}.json`, encodeShard({ 'x|exalted': pts }));
  return dir;
}
function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
  const srv = createServer((req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try { const body = readFileSync(join(dir, p)); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}/coffres-poe2.html` })));
}

const num = s => Number(String(s).replace(/ | |\s/g, '').replace(/[^\d,.-]/g, '').replace(',', '.'));
const post = (page, type, data) => page.evaluate(([type, data]) => window.postMessage(JSON.stringify({ src: 'poe-us', type, data }), '*'), [type, data]);
const text = (page, id) => page.evaluate(i => document.getElementById(i).innerText, id);
const rowText = (page, name) => page.evaluate(n => [...document.querySelectorAll('tr.it')].map(r => r.innerText.replace(/\s+/g, ' ')).find(t => t.includes(n)) || '', name);
async function paste(page, t) {
  await page.click('#pasteBtn');
  await page.fill('#pText', t);
  await page.click('#pAdd');
  await page.waitForTimeout(200);
}
async function openPage(browser, url, { version = REQ } = {}) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.addInitScript(() => { window.__cmds = []; window.addEventListener('message', e => { try { const m = JSON.parse(e.data); if (m.src === 'poe-viewer') window.__cmds.push(m); } catch {} }); });
  await page.goto(url);
  await page.waitForFunction(() => /prix/.test(document.getElementById('kFreshSub').textContent), null, { timeout: 10000 });
  if (version) { await post(page, 'ready', { version, inst: 'test' }); await post(page, 'settings', { account: 'Testeur#0001' }); }
  await page.waitForTimeout(300);
  return { page, errors };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
let ctx;

test('chargement : ligue, taux et prix publiés', async () => {
  equal(await ctx.page.inputValue('#league'), LG);
  ok(/472 ex/.test(await text(ctx.page, 'kRate')), 'divine = 471,8 ex, arrondi');
  ok(num(await ctx.page.evaluate(() => document.getElementById('nPrices').textContent)) > 10);
});
test('page vide : explique pourquoi les coffres PoE2 ne sont pas lus', async () => {
  ok(/GGG ne publie pas les coffres PoE2/.test(await text(ctx.page, 'view')));
});
test('ventes : commande envoyée au script avec la ligue, résultats affichés et valorisés', async () => {
  await ctx.page.click('#listedBtn');
  await ctx.page.waitForFunction(() => window.__cmds.some(m => m.cmd === 'listed2'), null, { timeout: 3000 });
  const c = await ctx.page.evaluate(() => window.__cmds.filter(m => m.cmd === 'listed2').pop());
  equal(c && c.data.league, LG, `commande : ${JSON.stringify(c)}`);
  await post(ctx.page, 'status', { msg: 'Ventes PoE2 : 3 objets en vente.', p: 1, done: true });
  await post(ctx.page, 'listed2', LISTED);
  await ctx.page.waitForTimeout(300);
  ok(/125 div/.test(await rowText(ctx.page, 'Mageblood')), 'Mageblood coté 125 div');
  ok(/non coté/.test(await rowText(ctx.page, 'Storm Loop')), 'rare non coté');
  const tot = num((await text(ctx.page, 'kTotal')).split('div')[0]);
  ok(/^125 div/.test(await text(ctx.page, 'kTotal')), `total ${tot}`);
  ok(/valeur poe.ninja 125 div/.test(await text(ctx.page, 'count')), await text(ctx.page, 'count'));
  const sale = num((await text(ctx.page, 'kSale')).split('div')[0]);
  ok(Math.abs(sale - 3.106) < 0.006, `en vente ${sale}`);
  equal(await ctx.page.isDisabled('#listedBtn'), false, 'bouton réactivé');
});
test('coller : monnaie avec pile, unique, rare', async () => {
  await paste(ctx.page, 'Item Class: Stackable Currency\nRarity: Currency\nDivine Orb\n--------\nStack Size: 3/20\n--------\nRandomises the numeric values of modifiers\n--------\nRight click this item then left click');
  ok(/3,00 div/.test(await rowText(ctx.page, 'Divine Orb')), await rowText(ctx.page, 'Divine Orb'));
  await paste(ctx.page, "Item Class: Rings\nRarity: Unique\nBursting Decay\nGold Ring\n--------\nRequires: Level 45\n--------\nItem Level: 80\n--------\n+12% to Rarity of Items found (implicit)\n--------\n+30 to maximum Life\nEnemies you kill explode\n--------\nA flavour text.\n--------\nCorrupted");
  const d = await text(ctx.page, 'detail');
  ok(/98,00 div/.test(d) && /Enemies you kill explode/.test(d) && /Corrupted/.test(d) && !/flavour/.test(d), d.replace(/\s+/g, ' ').slice(0, 400));
  await paste(ctx.page, 'Item Class: Rings\nRarity: Rare\nGale Coil\nSapphire Ring\n--------\nItem Level: 79\n--------\n+70 to maximum Life');
  ok(/non coté/.test(await rowText(ctx.page, 'Gale Coil')));
  ok(/226 div/.test(await text(ctx.page, 'count')), await text(ctx.page, 'count'));
});
test('coller un texte qui n\'est pas un objet : message d\'erreur, rien ajouté', async () => {
  const n0 = await ctx.page.evaluate(() => document.querySelectorAll('tr.it').length);
  await ctx.page.click('#pasteBtn'); await ctx.page.fill('#pText', 'bonjour'); await ctx.page.click('#pAdd');
  ok(/illisible/.test(await text(ctx.page, 'pErr')));
  await ctx.page.keyboard.press('Escape');
  equal(await ctx.page.evaluate(() => document.querySelectorAll('tr.it').length), n0);
});
test('retirer un objet collé', async () => {
  await ctx.page.evaluate(() => [...document.querySelectorAll('tr.it')].find(r => r.innerText.includes('Gale Coil')).querySelector('[data-del]').click());
  equal(await rowText(ctx.page, 'Gale Coil'), '');
});
test('prix : recherche, surveillance, historique', async () => {
  await ctx.page.click('#tPrices');
  await ctx.page.fill('#q', 'exalted'); await ctx.page.waitForTimeout(200);
  await ctx.page.evaluate(() => document.querySelector('[data-w="x|exalted"]').click());
  ok(/Exalted Orb/.test(await text(ctx.page, 'watchList')));
  await ctx.page.evaluate(() => document.querySelector('tr.it[data-k="x|exalted"]').click());
  await ctx.page.waitForFunction(() => document.querySelector('#detail .hchart svg'), null, { timeout: 5000 });
  ok(/\+[\d,]+ %/.test(await text(ctx.page, 'detail')), 'variation affichée');
});
test('rechargement : objets collés, ventes et surveillés gardés', async () => {
  await ctx.page.reload();
  await ctx.page.waitForFunction(() => /prix/.test(document.getElementById('kFreshSub').textContent), null, { timeout: 10000 });
  await ctx.page.waitForTimeout(300);
  ok(/Exalted Orb/.test(await text(ctx.page, 'watchList')));
  ok(await rowText(ctx.page, 'Bursting Decay') && await rowText(ctx.page, 'Mageblood'));
});
test('Ctrl+V sur la page ajoute l\'objet', async () => {
  await ctx.page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Item Class: Stackable Currency\nRarity: Currency\nExalted Orb\n--------\nStack Size: 40/5000'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
  await ctx.page.waitForTimeout(200);
  ok(/collé.* 40 /.test(await rowText(ctx.page, 'Exalted Orb')) || (await ctx.page.evaluate(() => [...document.querySelectorAll('tr.it')].some(r => /Exalted Orb/.test(r.innerText) && /collé/.test(r.innerText) && /\b40\b/.test(r.innerText)))));
});
if (process.env.SHOT) test('captures (SHOT=dossier)', async () => {
  await ctx.page.click('#tMine'); await ctx.page.evaluate(() => document.querySelector('tr.it').click()); await ctx.page.waitForTimeout(300);
  await ctx.page.screenshot({ path: join(process.env.SHOT, 'poe2-mine.png') });
  await ctx.page.click('#tPrices'); await ctx.page.evaluate(() => document.querySelector('tr.it[data-k="x|exalted"]').click()); await ctx.page.waitForTimeout(500);
  await ctx.page.screenshot({ path: join(process.env.SHOT, 'poe2-prix.png') });
});
test('aucune erreur JavaScript', async () => { ok(!ctx.errors.length, ctx.errors.slice(0, 3).join(' / ')); });
test('script trop ancien : bandeau de mise à jour, ventes refusées', async () => {
  const { page } = await openPage(ctx.browser, ctx.url, { version: '2.8.1' });
  ok(!(await page.isHidden('#updBar')), 'bandeau affiché');
  await page.click('#listedBtn');
  equal(await page.evaluate(() => window.__cmds.filter(m => m.cmd === 'listed2').length), 0);
  await page.close();
});

const dir = await buildSite();
const site = await serve(dir);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let fail = 0;
try {
  ctx = { browser, url: site.url, ...(await openPage(browser, site.url)) };
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok   ${name}`); }
    catch (e) { fail++; console.log(`ÉCHEC ${name}\n     ${String(e.message).split('\n').slice(0, 3).join('\n     ')}`); await ctx.page.keyboard.press('Escape').catch(() => {}); }
  }
} finally {
  if (fail && ctx) await ctx.page.screenshot({ path: join(tmpdir(), 'coffres2-test-echec.png') }).catch(() => {});
  await browser.close(); site.srv.close(); rmSync(dir, { recursive: true, force: true });
}
console.log(`${tests.length - fail}/${tests.length} tests réussis${fail ? ` (capture : ${join(tmpdir(), 'coffres2-test-echec.png')})` : ''}`);
process.exit(fail ? 1 : 0);
