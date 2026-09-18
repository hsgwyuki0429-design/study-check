// icons/icon.svg から、ホーム画面に置くための PNG を作る。
//
//   npm run build:icons
//
// 元は SVG 1枚だけにしてある。PNG を手で描き分けると、直したときに
// どれか1つだけ古いまま残る。ここで作り直せば必ずそろう。
//
// 180 は iOS（apple-touch-icon）、192 と 512 は Android（マニフェスト）が使う。
// 透明は持たせない。iOS は透明を黒で塗るので、縁が黒く出てしまう。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SIZES = [180, 192, 512];

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright が要ります: npm install --no-save playwright");
  process.exit(1);
}

const svg = readFileSync(path.join(root, "icons/icon.svg"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();

for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:#2563eb}`
    + `svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const file = path.join(root, `icons/icon-${size}.png`);
  await page.screenshot({ path: file });
  console.log(`icons/icon-${size}.png`);
}

await browser.close();
