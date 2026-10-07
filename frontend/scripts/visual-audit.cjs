#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Visual audit — screenshots plus layout metrics for the app's routes at phone, tablet and
 * desktop widths. Used two ways:
 *
 *   1. Review the mobile/tablet view (open the PNGs, or feed them to a gallery).
 *   2. Prove desktop did not change: capture a baseline before a change and an "after" run on
 *      the same data, then compare with `scripts/visual-diff.cjs`.
 *
 * Needs: the frontend dev server (default http://127.0.0.1:3000), the backend (default
 * http://127.0.0.1:3001/api), Google Chrome installed, and the `puppeteer-core` devDependency.
 * Nothing is downloaded — the installed Chrome is driven directly.
 *
 * Usage:
 *   AUDIT_OWNER_EMAIL=... AUDIT_OWNER_PASSWORD=... \
 *   AUDIT_CASHIER_EMAIL=... AUDIT_CASHIER_PASSWORD=... \
 *   node scripts/visual-audit.cjs --out .visual-audit/baseline
 *
 * Options:
 *   --out <dir>          where PNGs + metrics.json go (default .visual-audit/<timestamp>)
 *   --viewports a,b,c    subset of: phone-s-360 phone-390 tablet-p-768 tablet-l-1024 desktop-1280 desktop-1440
 *   --routes a,b         only routes whose path starts with one of these (e.g. /pos,/admin/orders)
 *   --settle <ms>        extra wait after the page goes quiet before measuring (default 1200;
 *                        raise it when charts or live data make two captures of the same code
 *                        differ — the dashboard's recharts animations need ~4000)
 *   --clock <ISO|ms>     every page load starts the browser clock at this instant (defaults to
 *                        now; saved to <out>/clock.txt — pass it to the next run for identical
 *                        relative times, "today" filters and date ranges)
 *   --base <url>         frontend origin      --api <url>  backend API base
 *   --chrome <path>      Chrome binary (default $CHROME_PATH or /usr/bin/google-chrome)
 *   --ids order=267,customer=63,branch=10,role=19   record ids used by detail routes
 *
 * Metrics per page: horizontal overflow in px, widest offending elements, tap targets under
 * 40px, tables and how many sit in a horizontal-scroll wrapper, console errors, final URL.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def;
};

const BASE = opt('base', 'http://127.0.0.1:3000');
const API = opt('api', 'http://127.0.0.1:3001/api');
const CHROME = opt('chrome', process.env.CHROME_PATH || '/usr/bin/google-chrome');
const OUT = path.resolve(opt('out', path.join('.visual-audit', new Date().toISOString().replace(/[:.]/g, '-'))));
const ROUTE_PREFIXES = opt('routes', '').split(',').map((s) => s.trim()).filter(Boolean);
const SETTLE = Number(opt('settle', '1200'));
const clockArg = opt('clock', '');
const CLOCK = clockArg ? (Number.isFinite(Number(clockArg)) ? Number(clockArg) : Date.parse(clockArg)) : Date.now();
if (!Number.isFinite(CLOCK)) throw new Error(`--clock "${clockArg}" is not a date`);

const IDS = { order: '1', customer: '1', branch: '1', role: '1' };
for (const kv of (opt('ids', '') || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (k && v) IDS[k.trim()] = v.trim();
}

const USERS = {
  owner: { email: process.env.AUDIT_OWNER_EMAIL, password: process.env.AUDIT_OWNER_PASSWORD },
  cashier: { email: process.env.AUDIT_CASHIER_EMAIL, password: process.env.AUDIT_CASHIER_PASSWORD },
};

const ALL_VIEWPORTS = [
  { name: 'phone-s-360', width: 360, height: 740, mobile: true },
  { name: 'phone-390', width: 390, height: 844, mobile: true },
  { name: 'tablet-p-768', width: 768, height: 1024, mobile: true },
  { name: 'tablet-l-1024', width: 1024, height: 768, mobile: true },
  { name: 'desktop-1280', width: 1280, height: 800, mobile: false },
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false },
];
const wanted = opt('viewports', '');
const VIEWPORTS = wanted ? ALL_VIEWPORTS.filter((v) => wanted.split(',').includes(v.name)) : ALL_VIEWPORTS;

// [route, user] — user null means logged out. Routes that exist only on staging (Employee HRM,
// the attendance station) are deliberately absent so the list works on main.
const ROUTES = [
  ['/login', null],
  ['/admin/dashboard', 'owner'],
  ['/admin/orders', 'owner'],
  [`/admin/orders/${IDS.order}`, 'owner'],
  ['/admin/deliveries', 'owner'],
  ['/admin/shifts', 'owner'],
  ['/admin/menu-items', 'owner'],
  ['/admin/categories', 'owner'],
  ['/admin/deals', 'owner'],
  ['/admin/modifiers', 'owner'],
  ['/admin/branch-menu-items', 'owner'],
  ['/admin/customers', 'owner'],
  [`/admin/customers/${IDS.customer}`, 'owner'],
  ['/admin/discounts', 'owner'],
  ['/admin/coupons', 'owner'],
  ['/admin/printed-vouchers', 'owner'],
  ['/admin/banners', 'owner'],
  ['/admin/users', 'owner'],
  ['/admin/branch-users', 'owner'],
  ['/admin/roles', 'owner'],
  ['/admin/roles/new', 'owner'],
  ['/admin/branches', 'owner'],
  [`/admin/branches/${IDS.branch}`, 'owner'],
  ['/admin/brands', 'owner'],
  ['/admin/business-settings', 'owner'],
  ['/admin/reports', 'owner'],
  ['/admin/reports/product-sales', 'owner'],
  ['/admin/reports/printed-vouchers', 'owner'],
  ['/admin/activity-logs', 'owner'],
  ['/admin/inventory/on-hand', 'owner'],
  ['/admin/inventory/items', 'owner'],
  ['/admin/inventory/stocktake', 'owner'],
  ['/admin/procurement/pos', 'owner'],
  ['/admin/recipes/manage', 'owner'],
  ['/admin/rider-hrm/profiles', 'owner'],
  ['/admin/rider-hrm/payroll', 'owner'],
  ['/kitchen', 'owner'],
  ['/kitchen/back', 'owner'],
  ['/foh/packing', 'owner'],
  ['/pos/orders', 'cashier'],
  ['/pos/orders', 'owner'],
].filter(([route]) => ROUTE_PREFIXES.length === 0 || ROUTE_PREFIXES.some((p) => route.startsWith(p)));

async function login(u) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(u),
  });
  if (!r.ok) throw new Error(`login ${u.email} -> HTTP ${r.status}`);
  return (await r.json()).token;
}

const slug = (route) => route.replace(/^\//, '').replace(/[/:]/g, '_') || 'root';

// Runs inside the page: layout facts a human would otherwise eyeball.
function measureInPage() {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const hOverflow = Math.max(de.scrollWidth, document.body.scrollWidth) - vw;
  const wide = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 2 && getComputedStyle(el).position !== 'fixed') {
      const cls = typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.')
        : '';
      wide.push({ tag: el.tagName.toLowerCase() + cls, right: Math.round(r.right), width: Math.round(r.width) });
      if (wide.length >= 8) break;
    }
  }
  let taps = 0;
  let smallTap = 0;
  for (const el of document.querySelectorAll('button, a[href], [role=button], input[type=checkbox], input[type=radio]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    taps++;
    if (r.width < 40 || r.height < 40) smallTap++;
  }
  const tables = [...document.querySelectorAll('table')];
  const tablesScrollable = tables.filter((t) => {
    let p = t.parentElement;
    for (let n = 0; p && n < 3; n++, p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  }).length;
  return {
    vw,
    hOverflow,
    wide,
    taps,
    smallTap,
    tables: tables.length,
    tablesScrollable,
    title: document.title,
    url: location.pathname,
    scrollHeight: de.scrollHeight,
  };
}

// Pinned clock + no CSS motion, so two runs on the same data produce the same pixels. Every
// page load starts the clock at the same instant and lets it run from there (a fully frozen
// clock stalls recharts' bar animations, so chart bodies came out half-drawn at random).
function freezeInPage(fixedNow) {
  const RealDate = Date;
  const realStart = RealDate.now();
  const pinnedNow = () => fixedNow + (RealDate.now() - realStart);
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(pinnedNow());
      else super(...args);
    }
    static now() {
      return pinnedNow();
    }
  }
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;
  // eslint-disable-next-line no-global-assign
  window.Date = FrozenDate;
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
}

async function runViewport(browser, vp, tokens, results) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  if (vp.mobile) {
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Mobile Safari/537.36');
  }
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(freezeInPage, CLOCK);
  const dir = path.join(OUT, vp.name);
  fs.mkdirSync(dir, { recursive: true });

  let consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 160)));

  // Prime the origin so localStorage can be written before the first real navigation.
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  let currentUser;
  for (const [route, user] of ROUTES) {
    if (user && !tokens[user]) {
      results.push({ viewport: vp.name, route, user, skipped: `no credentials for ${user}` });
      continue;
    }
    consoleErrors = [];
    if (user !== currentUser) {
      await page.evaluate((t) => { localStorage.clear(); if (t) localStorage.setItem('auth_token', t); }, user ? tokens[user] : null);
      currentUser = user;
    }
    const t0 = Date.now();
    try {
      await Promise.race([
        page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 20000 }),
        new Promise((res) => setTimeout(res, 12000)),
      ]);
    } catch (e) {
      consoleErrors.push('nav: ' + String(e).slice(0, 120));
    }
    await new Promise((res) => setTimeout(res, SETTLE));
    await page.evaluate(() => { document.querySelectorAll('.swal2-container').forEach((e) => e.remove()); });
    const m = await page.evaluate(measureInPage).catch((e) => ({ error: String(e) }));
    const name = slug(route) + (user === 'cashier' ? '--cashier' : '');
    const file = path.join(dir, `${name}.png`);
    const h = Math.min(Math.max(vp.height, m.scrollHeight || vp.height), 2600);
    try {
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: vp.width, height: h }, captureBeyondViewport: true });
    } catch (e) {
      consoleErrors.push('shot: ' + String(e).slice(0, 120));
    }
    results.push({ viewport: vp.name, route, user, ms: Date.now() - t0, ...m, consoleErrors: consoleErrors.slice(0, 5), file: path.relative(OUT, file) });
    console.log(`${vp.name} ${route}${user === 'cashier' ? ' (cashier)' : ''} -> overflow ${m.hOverflow}px, tables ${m.tables || 0}/${m.tablesScrollable || 0} scrollable, small taps ${m.smallTap}/${m.taps}, landed ${m.url}`);
  }
  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'clock.txt'), String(CLOCK));
  const tokens = {};
  for (const [k, u] of Object.entries(USERS)) {
    if (u.email && u.password) tokens[k] = await login(u);
    else console.warn(`no AUDIT_${k.toUpperCase()}_EMAIL/PASSWORD — routes for "${k}" will be skipped`);
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-first-run', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
  });
  const results = [];
  try {
    await Promise.all(VIEWPORTS.map((vp) => runViewport(browser, vp, tokens, results)));
  } finally {
    await browser.close();
  }
  results.sort((a, b) => a.viewport.localeCompare(b.viewport) || a.route.localeCompare(b.route));
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(results, null, 1));

  const lines = [];
  for (const vp of VIEWPORTS) {
    const rows = results.filter((r) => r.viewport === vp.name && !r.skipped);
    const bad = rows.filter((r) => r.hOverflow > 4);
    lines.push(`${vp.name}: ${bad.length}/${rows.length} pages overflow horizontally` + (bad.length ? ` — ${bad.map((r) => `${r.route} +${r.hOverflow}px`).join(', ')}` : ''));
  }
  fs.writeFileSync(path.join(OUT, 'summary.txt'), lines.join('\n') + '\n');
  console.log('\n' + lines.join('\n'));
  console.log(`\nDONE ${results.length} pages -> ${OUT} (clock ${new Date(CLOCK).toISOString()})`);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
