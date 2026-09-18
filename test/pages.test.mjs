// GitHub Pages へ配るものが足りているかの確認。
//
// 配るのはアプリ本体だけにしている。その並びを workflow に手で書いているので、
// ファイルを1つ足したときに書き忘れると、「その画面だけ開けないアプリ」が配られてしまう。
// Service Worker が要ると言っているものを基準に、過不足を見張る。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

/** workflow の cp 行から、配るものの一覧を読み取る。 */
function publishedPaths() {
  const workflow = read(".github/workflows/pages.yml");
  const paths = new Set();
  for (const line of workflow.split("\n")) {
    const match = line.match(/^\s*cp (?:-r )?(.+) _site\/$/);
    if (!match) continue;
    for (const entry of match[1].trim().split(/\s+/)) paths.add(entry);
  }
  return paths;
}

/** 配られる場所に、そのファイルが含まれるか。 */
const covered = (paths, file) =>
  paths.has(file) || [...paths].some((entry) => file.startsWith(`${entry}/`));

test("Service Worker が要るものは、すべて配られる", () => {
  const sw = read("sw.js");
  const shell = [...sw.matchAll(/'\.\/([^']*)'/g)].map((match) => match[1]).filter(Boolean);
  const paths = publishedPaths();

  const missing = shell.filter((entry) => !covered(paths, entry));
  assert.deepEqual(missing, [],
    `pages.yml で配られない: ${missing.join(", ")}（配らないとオフラインで開けない）`);
});

test("index.html が読み込むものも、すべて配られる", () => {
  const html = read("index.html");
  const referenced = [...html.matchAll(/(?:href|src)="(?!https?:|data:|#)([^"]+)"/g)]
    .map((match) => match[1].replace(/^\.\//, ""));
  const paths = publishedPaths();

  const missing = referenced.filter((entry) => !covered(paths, entry));
  assert.deepEqual(missing, [], `pages.yml で配られない: ${missing.join(", ")}`);
});

test("配ると書いたものが、実際に存在する", () => {
  for (const entry of publishedPaths()) {
    assert.ok(existsSync(path.join(root, entry)), `pages.yml にあるが実在しない: ${entry}`);
  }
});

test("テストや元データは配らない", () => {
  const paths = publishedPaths();
  for (const entry of ["test", "tools", "docs", "package.json", "README.md"]) {
    assert.equal(covered(paths, entry), false, `${entry} まで配ろうとしている`);
  }
});

test("Jekyll に通さない印を置いている", () => {
  // 通すと「_」で始まる名前が無視されるなど、素のファイルをそのまま配る作りと食い違う。
  assert.match(read(".github/workflows/pages.yml"), /touch _site\/\.nojekyll/);
});

test("アプリの中に、根元を前提にした絶対パスが無い", () => {
  // GitHub Pages のプロジェクトページは /study-check/ のように階層の途中に置かれる。
  // "/src/..." のような書き方が1つでもあると、そこだけ読めなくなる。
  // 属性値の「先頭」だけを見る。src="src/app.js" の途中に現れる "/" は絶対パスではない。
  const valuesOf = (source) => [
    ...[...source.matchAll(/(?:href|src)="([^"]*)"/g)].map((match) => match[1]),
    ...[...source.matchAll(/"(?:start_url|scope)"\s*:\s*"([^"]*)"/g)].map((match) => match[1]),
    ...[...source.matchAll(/register\(\s*'([^']*)'/g)].map((match) => match[1]),
  ];

  for (const file of ["index.html", "sw.js", "manifest.webmanifest", "src/app.js"]) {
    const absolute = valuesOf(read(file))
      .filter((value) => value.startsWith("/") && !value.startsWith("//"));
    assert.deepEqual(absolute, [], `${file} に根元からの絶対パスがある: ${absolute.join(", ")}`);
  }
});
