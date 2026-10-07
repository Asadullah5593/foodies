#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Pixel-compares two `visual-audit.cjs` runs and reports every page that changed.
 *
 *   node scripts/visual-diff.cjs --base .visual-audit/baseline --after .visual-audit/after \
 *        [--viewports desktop-1280,desktop-1440] [--threshold 0.1] [--max-diff-px 0]
 *
 * Writes <after>/diff/<viewport>/<page>.png (changed pixels in red) and <after>/diff/summary.json,
 * prints a table sorted by changed pixels, and exits 1 when any page exceeds --max-diff-px.
 * Pages whose capture height differs are reported too (the common area is still compared).
 *
 * Expect two kinds of noise on a "nothing should change" run: live data that moved between the
 * two captures, and /login's floating decorations. Open the diff PNG before concluding anything.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def;
};
const BASE = path.resolve(opt('base', ''));
const AFTER = path.resolve(opt('after', ''));
if (!opt('base', '') || !opt('after', '')) {
  console.error('usage: visual-diff.cjs --base <dir> --after <dir> [--viewports a,b] [--threshold 0.1] [--max-diff-px 0]');
  process.exit(2);
}
const THRESHOLD = Number(opt('threshold', '0.1'));
const MAX_DIFF = Number(opt('max-diff-px', '0'));
const wanted = opt('viewports', '');
const viewports = fs.readdirSync(BASE).filter((d) => fs.statSync(path.join(BASE, d)).isDirectory() && (!wanted || wanted.split(',').includes(d)));

const rows = [];
for (const vp of viewports) {
  const baseDir = path.join(BASE, vp);
  const afterDir = path.join(AFTER, vp);
  if (!fs.existsSync(afterDir)) {
    rows.push({ viewport: vp, page: '*', status: 'missing-after' });
    continue;
  }
  const outDir = path.join(AFTER, 'diff', vp);
  for (const file of fs.readdirSync(baseDir).filter((f) => f.endsWith('.png')).sort()) {
    const a = path.join(baseDir, file);
    const b = path.join(afterDir, file);
    if (!fs.existsSync(b)) {
      rows.push({ viewport: vp, page: file, status: 'missing-after' });
      continue;
    }
    const imgA = PNG.sync.read(fs.readFileSync(a));
    const imgB = PNG.sync.read(fs.readFileSync(b));
    const w = Math.min(imgA.width, imgB.width);
    const h = Math.min(imgA.height, imgB.height);
    const crop = (img) => {
      if (img.width === w && img.height === h) return img.data;
      const out = Buffer.alloc(w * h * 4);
      for (let y = 0; y < h; y++) img.data.copy(out, y * w * 4, y * img.width * 4, y * img.width * 4 + w * 4);
      return out;
    };
    const diff = new PNG({ width: w, height: h });
    const changed = pixelmatch(crop(imgA), crop(imgB), diff.data, w, h, { threshold: THRESHOLD, includeAA: false });
    const sizeNote = imgA.height !== imgB.height || imgA.width !== imgB.width ? `${imgA.width}x${imgA.height} -> ${imgB.width}x${imgB.height}` : '';
    if (changed > 0 || sizeNote) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, file), PNG.sync.write(diff));
    }
    rows.push({ viewport: vp, page: file, changed, pct: +((100 * changed) / (w * h)).toFixed(3), size: sizeNote, status: changed > MAX_DIFF || sizeNote ? 'CHANGED' : 'same' });
  }
}

rows.sort((x, y) => (y.changed || 0) - (x.changed || 0));
fs.mkdirSync(path.join(AFTER, 'diff'), { recursive: true });
fs.writeFileSync(path.join(AFTER, 'diff', 'summary.json'), JSON.stringify(rows, null, 1));

const changedRows = rows.filter((r) => r.status !== 'same');
for (const vp of viewports) {
  const all = rows.filter((r) => r.viewport === vp);
  const bad = all.filter((r) => r.status !== 'same');
  console.log(`${vp}: ${all.length - bad.length}/${all.length} identical`);
  for (const r of bad) console.log(`  ${r.status.padEnd(14)} ${r.page.padEnd(40)} ${r.changed != null ? `${r.changed} px (${r.pct}%)` : ''} ${r.size || ''}`);
}
process.exit(changedRows.length ? 1 : 0);
