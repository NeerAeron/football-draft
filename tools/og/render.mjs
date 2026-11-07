// Renders the share image and the app icons with Playwright + the pre-installed Chromium:
//
//   node tools/og/render.mjs
//
// → app/assets/og-image.png        1200 × 630 Open Graph / Twitter card (tools/og/og-image.html)
//   app/assets/icons/icon.svg      the brand mark (favicon, any size)
//   app/assets/icons/icon-192.png, icon-512.png            manifest "any" icons
//   app/assets/icons/icon-maskable-512.png                 manifest "maskable" (safe zone)
//   app/assets/icons/apple-touch-icon.png                  180 × 180, opaque (iOS home screen)
// Re-run after changing the brand mark or the card; commit the PNGs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

const root = resolve(import.meta.dirname, '../..');
const icons = resolve(root, 'app/assets/icons');
mkdirSync(icons, { recursive: true });

// The brand mark from app/ui/shell/brand.js (volt badge, ink ball, volt patch and seams).
const MARK = `<rect x="1" y="1" width="38" height="38" rx="11" fill="#cdf545"/>
<circle cx="20" cy="20" r="11.5" fill="#070b16"/>
<path d="M20 14.2l5.5 4-2.1 6.5h-6.8l-2.1-6.5z" fill="#cdf545"/>
<path d="M20 14.2V8.5M25.5 18.2l5.4-1.8M23.4 24.7l3.4 4.6M16.6 24.7l-3.4 4.6M14.5 18.2l-5.4-1.8" fill="none" stroke="#cdf545" stroke-width="1.6" stroke-linecap="round"/>`;
const svg = (inner, viewBox = '0 0 40 40') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`;

// "any" icon: the badge itself, transparent corners.
const ANY = svg(MARK);
// Maskable / Apple: the badge's volt full-bleed (the OS applies its own mask or corners);
// the ball stays well inside the 80 % safe zone.
const FULL = svg(
  `<rect width="40" height="40" fill="#cdf545"/>
<g transform="translate(20 20) scale(1.1) translate(-20 -20)">
<circle cx="20" cy="20" r="11.5" fill="#070b16"/>
<path d="M20 14.2l5.5 4-2.1 6.5h-6.8l-2.1-6.5z" fill="#cdf545"/>
<path d="M20 14.2V8.5M25.5 18.2l5.4-1.8M23.4 24.7l3.4 4.6M16.6 24.7l-3.4 4.6M14.5 18.2l-5.4-1.8" fill="none" stroke="#cdf545" stroke-width="1.6" stroke-linecap="round"/></g>`,
);
writeFileSync(resolve(icons, 'icon.svg'), ANY + '\n');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(pathToFileURL(resolve(root, 'tools/og/og-image.html')).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every(i => i.complete));
  await page.locator('#card').screenshot({ path: resolve(root, 'app/assets/og-image.png') });

  const shot = async (markup, size, file, transparent) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:${transparent ? 'transparent' : '#070b16'}">
      <div id="i" style="width:${size}px;height:${size}px">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`,
    );
    await page
      .locator('#i')
      .screenshot({ path: resolve(icons, file), omitBackground: !!transparent });
  };
  await shot(ANY, 192, 'icon-192.png', true);
  await shot(ANY, 512, 'icon-512.png', true);
  await shot(FULL, 512, 'icon-maskable-512.png', false);
  await shot(FULL, 180, 'apple-touch-icon.png', false);
} finally {
  await browser.close();
}
console.log('wrote app/assets/og-image.png and app/assets/icons/*');
