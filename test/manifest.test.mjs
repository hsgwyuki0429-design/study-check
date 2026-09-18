// ホーム画面に追加できるか（PWA として必要なものがそろっているか）。
//
// ここが欠けても、ふだんの画面はふつうに動いてしまう。
// 気づくのは「ホーム画面に追加しても、名前が変・アイコンが白い四角」のときなので、
// 出す前に持ち物を数えておく。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const manifest = JSON.parse(read("manifest.webmanifest"));
const html = read("index.html");

/** PNG の実寸と、透明を持っているかを、ファイルの頭から読む。 */
function pngInfo(relative) {
  const data = readFileSync(path.join(root, relative));
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${relative} が PNG でない`);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  // カラータイプ 4 と 6 が透明を持つ形式。
  const hasAlpha = data[25] === 4 || data[25] === 6;
  return { width, height, hasAlpha };
}

test("アプリ名は Study Check", () => {
  assert.equal(manifest.name, "Study Check");
  assert.equal(manifest.short_name, "Study Check");
  // iOS はホーム画面の名前にこれを使う。無いと <title> が使われる。
  assert.match(html, /name="apple-mobile-web-app-title" content="Study Check"/);
  assert.match(html, /<title>Study Check<\/title>/);
});

test("ホーム画面から開いたとき、ブラウザの枠が出ない", () => {
  assert.equal(manifest.display, "standalone");
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
});

test("入口と守備範囲が、置き場所について回る書き方になっている", () => {
  // GitHub Pages では /study-check/ の下に置かれる。根元からの絶対パスだと開けない。
  for (const value of [manifest.start_url, manifest.scope, manifest.id]) {
    assert.ok(value.startsWith("./") || value === "./", `絶対パスになっている: ${value}`);
  }
});

test("Android に要る大きさのアイコンがそろっている", () => {
  const sizes = manifest.icons
    .filter((icon) => icon.type === "image/png")
    .map((icon) => icon.sizes);
  assert.ok(sizes.includes("192x192"), "192x192 が無い");
  assert.ok(sizes.includes("512x512"), "512x512 が無い");
});

test("切り抜かれる端末むけのアイコン（maskable）がある", () => {
  // これが無いと、Android のホーム画面で白い下地の上に縮んで置かれる。
  const maskable = manifest.icons.filter((icon) => (icon.purpose ?? "").split(" ").includes("maskable"));
  assert.ok(maskable.length > 0, "maskable のアイコンが無い");
  for (const icon of maskable) {
    assert.equal(icon.type, "image/png", "maskable は PNG で用意する");
  }
});

test("マニフェストに書いたアイコンが、実際にあって大きさも合っている", () => {
  for (const icon of manifest.icons) {
    assert.ok(existsSync(path.join(root, icon.src)), `${icon.src} が無い`);
    if (icon.type !== "image/png") continue;
    const [width, height] = icon.sizes.split("x").map(Number);
    const info = pngInfo(icon.src);
    assert.equal(info.width, width, `${icon.src} の幅が違う`);
    assert.equal(info.height, height, `${icon.src} の高さが違う`);
  }
});

test("iOS むけのアイコンがあり、透明を持っていない", () => {
  const match = html.match(/rel="apple-touch-icon" href="([^"]+)"/);
  assert.ok(match, "apple-touch-icon が無い");
  const info = pngInfo(match[1]);
  assert.equal(info.width, 180, "iOS むけは 180x180 で用意する");
  // iOS は透明を黒で埋めるので、透明のまま渡すと縁が黒くなる。
  assert.equal(info.hasAlpha, false, `${match[1]} が透明を持っている`);
});

test("アイコンは、オフラインでも取り出せるようにしてある", () => {
  const sw = read("sw.js");
  for (const icon of manifest.icons) {
    assert.ok(sw.includes(`'./${icon.src}'`), `sw.js に ${icon.src} が入っていない`);
  }
});

test("アイコンは、読み込みを待たせない大きさに収まっている", () => {
  for (const icon of manifest.icons) {
    const bytes = statSync(path.join(root, icon.src)).size;
    assert.ok(bytes < 100 * 1024, `${icon.src} が大きすぎる: ${bytes} bytes`);
  }
});
