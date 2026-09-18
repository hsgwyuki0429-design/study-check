// 問題マスタ（data/questions.json）そのものと、
// それが PWA → 同期 → Cloudflare KV → MCP の経路を通っても
// 項目が落ちないことを確かめる。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildQuestions, checkQuestions, summarize } from "../tools/build-questions.mjs";
import { compareQuestions, normalizeQuestion, questionHaystack, buildOutline, QUESTION_FIELDS } from "../src/question-order.js";
import { hashQuestions } from "../src/hash.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function master() {
  const text = await readFile(join(ROOT, "data", "questions.json"), "utf8");
  return JSON.parse(text);
}

/* ------------------------------------------------------------------ */
/* 問題マスタそのもの                                                  */
/* ------------------------------------------------------------------ */

test("data/questions.json は tools/build-questions.mjs の出力と一致する", async () => {
  const document = await master();
  const built = buildQuestions();
  assert.equal(document.questions.length, built.length);
  assert.deepEqual(document.questions, built);
  assert.equal(document.questionCount, built.length);
});

test("問題マスタの整合性チェックが通る", async () => {
  const { questions } = await master();
  assert.deepEqual(checkQuestions(questions), []);
});

test("IDが一意で、教科をまたいで衝突しない", async () => {
  const { questions } = await master();
  const ids = new Set(questions.map((q) => q.id));
  assert.equal(ids.size, questions.length);

  // 数学I 例題1 と 数学A 例題1 は別の問題。番号が同じでもIDは別。
  const first = questions.filter((q) => q.type === "基本例題" && q.number === 1);
  assert.equal(first.length, 2);
  assert.equal(new Set(first.map((q) => q.id)).size, 2);
  assert.deepEqual(first.map((q) => q.subject).sort(), ["数学A", "数学I"]);
});

test("章・単元・種類が空の問題が無い", async () => {
  const { questions } = await master();
  for (const q of questions) {
    assert.ok(q.subject, `subject が空: ${q.id}`);
    assert.ok(q.chapter, `chapter が空: ${q.id}`);
    assert.ok(q.section, `section が空: ${q.id}`);
    assert.ok(q.type, `type が空: ${q.id}`);
    assert.ok(q.label, `label が空: ${q.id}`);
  }
});

test("資料に載っている種類だけを使っている", async () => {
  const { questions } = await master();
  const types = new Set(questions.map((q) => q.type));
  assert.deepEqual([...types].sort(), ["EXERCISES", "基本例題", "演習例題", "重要例題"].sort());
});

test("章ごと・種類ごとの問題数が例題一覧と一致する", async () => {
  const { questions } = await master();
  const summary = summarize(questions);
  // 数学I: 例題194 + EXERCISES134、数学A: 例題158 + EXERCISES107
  assert.equal(summary.bySubject["数学I"], 194 + 134);
  assert.equal(summary.bySubject["数学A"], 158 + 107);
  assert.equal(summary.total, 593);
  assert.equal(summary.byType.EXERCISES, 134 + 107);
  assert.deepEqual(summary.byCourse, { 基本定着: 170, 精選速習: 174, 実力錬成: 135 });
});

test("SELECT STUDY のコースが例題にだけ入っている", async () => {
  const { questions, courses } = await master();
  assert.deepEqual(courses, ["基本定着", "精選速習", "実力錬成"]);
  for (const q of questions) {
    assert.ok(Array.isArray(q.courses), `courses が配列でない: ${q.id}`);
    for (const c of q.courses) assert.ok(courses.includes(c), `知らないコース: ${q.id}`);
    if (q.type === "EXERCISES") assert.equal(q.courses.length, 0, `EXERCISESにコース: ${q.id}`);
  }
  // どのコースにも入らない例題もある（難関向けなど）。
  const examples = questions.filter((q) => q.type !== "EXERCISES");
  assert.ok(examples.some((q) => q.courses.length === 0));
  assert.ok(examples.some((q) => q.courses.length === 3));
});

test("掲載順に並べると、章・単元・ページが前へ戻らない", async () => {
  const { questions } = await master();
  const sorted = [...questions].sort(compareQuestions);

  // 数学Iが先、数学Aが後。
  const subjects = [...new Set(sorted.map((q) => q.subject))];
  assert.deepEqual(subjects, ["数学I", "数学A"]);

  for (const subject of subjects) {
    const list = sorted.filter((q) => q.subject === subject);
    let page = 0;
    let sectionOrder = 0;
    for (const q of list) {
      assert.ok(q.sectionOrder >= sectionOrder, `単元の順が戻った: ${q.id}`);
      if (q.sectionOrder > sectionOrder) {
        assert.ok(q.sectionPage >= page, `単元のページが戻った: ${q.id}`);
        page = q.sectionPage;
        sectionOrder = q.sectionOrder;
      }
    }
  }

  // 同じ単元の中では、例題が先で EXERCISES が後。
  const section = sorted.filter((q) => q.subject === "数学I" && q.sectionOrder === 1);
  assert.equal(section[0].type, "基本例題");
  assert.equal(section.at(-1).type, "EXERCISES");
});

test("章名の文字列順ではなく、教科書の掲載順で並ぶ", async () => {
  const { questions } = await master();
  const chapters = [...new Set([...questions].sort(compareQuestions)
    .filter((q) => q.subject === "数学I").map((q) => q.chapter))];
  assert.deepEqual(chapters, ["数と式", "集合と命題", "2次関数", "図形と計量", "データの分析"]);
});

test("推測で埋めた値が無い（難易度は1〜5、ページは整数）", async () => {
  const { questions } = await master();
  for (const q of questions) {
    assert.ok(Number.isInteger(q.difficulty) && q.difficulty >= 1 && q.difficulty <= 5, `難易度: ${q.id}`);
    // EXERCISES の掲載ページは出典が違うので持たない。埋めていないことを確かめる。
    if (q.type === "EXERCISES") assert.equal(q.page, null, `EXERCISESにページを補完してはいけない: ${q.id}`);
    else assert.ok(Number.isInteger(q.page), `例題のページ: ${q.id}`);
  }
});

/* ------------------------------------------------------------------ */
/* 整える処理・検索・目次                                              */
/* ------------------------------------------------------------------ */

test("normalizeQuestion は追加した項目を落とさない", async () => {
  const { questions } = await master();
  for (const q of questions) {
    const normalized = normalizeQuestion(q);
    assert.deepEqual(normalized, q, `項目が変わった: ${q.id}`);
  }
});

test("normalizeQuestion は古い形の問題も受け取れる", () => {
  const old = { id: "math1a-rei-9", subject: "数学I+A", chapter: "数列", section: "漸化式", type: "例題", number: 9, label: "例題 9" };
  const normalized = normalizeQuestion(old);
  assert.equal(normalized.id, "math1a-rei-9");
  assert.equal(normalized.difficulty, null);
  assert.equal(normalized.title, null);
  assert.equal(normalized.page, null);
  assert.equal(normalized.book, undefined);
  assert.equal(normalized.chapterOrder, undefined);
});

test("QUESTION_FIELDS に載っていない項目は指紋に含まれない＝全項目が載っている", async () => {
  const { questions } = await master();
  const keys = new Set();
  questions.forEach((q) => Object.keys(q).forEach((k) => keys.add(k)));
  for (const key of keys) assert.ok(QUESTION_FIELDS.includes(key), `指紋の対象から漏れている項目: ${key}`);
});

test("追加した項目を変えると問題マスタの指紋が変わる", async () => {
  const { questions } = await master();
  const before = await hashQuestions(questions);
  const changed = questions.map((q, i) => (i === 0 ? { ...q, page: 999 } : q));
  assert.notEqual(await hashQuestions(changed), before);

  const titleChanged = questions.map((q, i) => (i === 0 ? { ...q, title: "べつのタイトル" } : q));
  assert.notEqual(await hashQuestions(titleChanged), before);
});

test("検索はタイトルでも当たる", async () => {
  const { questions } = await master();
  const hit = questions.filter((q) => questionHaystack(q).includes("因数分解"));
  assert.ok(hit.length >= 11);
  assert.ok(hit.every((q) => q.section === "因数分解" || (q.title ?? "").includes("因数分解")));
});

test("同梱の問題マスタは版を持っている", async () => {
  const document = await master();
  assert.ok(Number.isInteger(document.masterVersion) && document.masterVersion >= 1,
    "data/questions.json に masterVersion が無い（中身を変えたら1つ上げること）");
});

test("目次は教科書の掲載順で、単元ごとのページと問題数を持つ", async () => {
  const { questions } = await master();
  const outline = buildOutline(questions);
  assert.deepEqual(outline.map((s) => s.subject), ["数学I", "数学A"]);
  const first = outline[0].chapters[0];
  assert.equal(first.chapter, "数と式");
  assert.equal(first.sectionDetails[0].section, "多項式の加法・減法・乗法");
  assert.equal(first.sectionDetails[0].page, 15);
  assert.equal(first.sectionDetails[0].questionCount, 9 + 6);
});
