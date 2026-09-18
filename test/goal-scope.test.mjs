// 目標の対象範囲のえらび方。単元は複数えらべる。

import { test } from "node:test";
import assert from "node:assert/strict";

import { selectQuestions, normalizeGoal } from "../src/goals.js";

const q = (id, chapter, section) => ({ id, subject: "数学I", chapter, section, type: "基本例題", number: 1 });

const QUESTIONS = [
  q("a1", "数と式", "多項式"),
  q("a2", "数と式", "多項式"),
  q("b1", "数と式", "実数"),
  q("c1", "数と式", "1次不等式"),
  q("d1", "2次関数", "2次関数のグラフ"),
];

test("単元を複数えらべる", () => {
  const picked = selectQuestions(QUESTIONS, { chapter: "数と式", sections: ["多項式", "1次不等式"] });
  assert.deepEqual(picked.map((x) => x.id), ["a1", "a2", "c1"]);
});

test("単元をえらばなければ、その章すべてが対象になる", () => {
  const picked = selectQuestions(QUESTIONS, { chapter: "数と式" });
  assert.deepEqual(picked.map((x) => x.id), ["a1", "a2", "b1", "c1"]);
});

test("単元を1つだけえらんでもよい", () => {
  const picked = selectQuestions(QUESTIONS, { chapter: "数と式", sections: ["実数"] });
  assert.deepEqual(picked.map((x) => x.id), ["b1"]);
});

test("ひとつだけ指定する古い形（section）も、そのまま受け取る", () => {
  const picked = selectQuestions(QUESTIONS, { chapter: "数と式", section: "実数" });
  assert.deepEqual(picked.map((x) => x.id), ["b1"]);
});

test("空の sections は「すべて」として扱う", () => {
  const picked = selectQuestions(QUESTIONS, { chapter: "数と式", sections: [] });
  assert.equal(picked.length, 4);
});

test("選んだ単元は、目標にそのまま残る", () => {
  const goal = normalizeGoal({
    id: "g1",
    title: "数と式",
    questionIds: ["a1", "a2", "c1"],
    scopeFilter: { chapter: "数と式", sections: ["多項式", "1次不等式"] },
  });
  assert.deepEqual(goal.scopeFilter.sections, ["多項式", "1次不等式"]);
});
