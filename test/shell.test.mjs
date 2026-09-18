// オフライン起動の確認。
//
// Service Worker のアプリシェルに、実際に読み込むファイルが全部入っていること。
// 1つ欠けると、オフラインのときその画面だけ開けない。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

test("Service Worker のシェルに src の JS が全部入っている", () => {
  const sw = read("sw.js");
  const shell = new Set([...sw.matchAll(/'\.\/(src\/[\w-]+\.js)'/g)].map((m) => m[1]));
  const files = readdirSync(path.join(root, "src")).filter((name) => name.endsWith(".js"));
  const missing = files.filter((name) => !shell.has(`src/${name}`));
  assert.deepEqual(missing, [], `sw.js の SHELL に入っていない: ${missing.join(", ")}`);

  // 逆に、消したファイルが残っていると install が丸ごと失敗する。
  const stale = [...shell].filter((entry) => !files.includes(path.basename(entry)));
  assert.deepEqual(stale, [], `sw.js の SHELL に実在しないファイルがある: ${stale.join(", ")}`);
});

test("オフラインで見つからないJSに、index.html を代わりに返さない", () => {
  const sw = read("sw.js");
  // 画面の読み込み（navigate）のときだけ index.html を返す作りになっていること。
  assert.match(sw, /isNavigation/);
  assert.match(sw, /if \(isNavigation\) \{[\s\S]*?index\.html/);
});
