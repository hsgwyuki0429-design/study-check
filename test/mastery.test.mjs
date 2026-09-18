// 習得判定（企画書4章・5章）と、維持フェーズで残す問題の選び方（8章）。

import { test } from "node:test";
import assert from "node:assert/strict";

import { masteryState, isMaintenanceTarget, WEAKNESS_LEVEL } from "../src/mastery.js";

const attempts = (...evaluations) => evaluations.map((evaluation, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, "0")}`,
  evaluation,
}));

test("perfect 1回では、まだクリアにしない", () => {
  const state = masteryState(attempts("perfect"));
  assert.equal(state.cleared, false);
  assert.equal(state.perfectStreak, 1);
});

test("perfect 2回でクリアになる", () => {
  const state = masteryState(attempts("perfect", "perfect"));
  assert.equal(state.cleared, true);
  assert.equal(state.clearedAt, "2026-09-02");
});

test("企画書の例：wrong_approach → perfect → perfect でクリア", () => {
  const state = masteryState(attempts("wrong_approach", "perfect", "perfect"));
  assert.equal(state.cleared, true);
});

test("企画書の例：perfect → perfect → wrong_approach でクリアが外れる", () => {
  const state = masteryState(attempts("perfect", "perfect", "wrong_approach"));
  assert.equal(state.cleared, false);
  assert.equal(state.lastEvaluation, "wrong_approach");
  assert.equal(state.brokenClearCount, 1);
});

test("クリアを外したあとは、もう一度 perfect 2回が要る", () => {
  const once = masteryState(attempts("perfect", "perfect", "wrong_approach", "perfect"));
  assert.equal(once.cleared, false, "perfect 1回でクリアに戻ってはいけない");
  const twice = masteryState(attempts("perfect", "perfect", "wrong_approach", "perfect", "perfect"));
  assert.equal(twice.cleared, true);
});

test("better_solution・calc_error・weak_writing でもクリアは外れる", () => {
  for (const evaluation of ["better_solution", "calc_error", "weak_writing"]) {
    const state = masteryState(attempts("perfect", "perfect", evaluation));
    assert.equal(state.cleared, false, `${evaluation} でクリアが残ってしまった`);
  }
});

test("評価が未登録の取り組みは、状態を動かさない", () => {
  const state = masteryState([
    { date: "2026-09-01", evaluation: "perfect" },
    { date: "2026-09-02", evaluation: null },
    { date: "2026-09-03", evaluation: "perfect" },
  ]);
  assert.equal(state.cleared, true, "未登録が弱点として扱われている");
  assert.equal(state.attemptCount, 3);
  assert.equal(state.evaluatedCount, 2);
});

test("同じ弱点が続いた回数を数える（周期の短縮に使う）", () => {
  assert.equal(masteryState(attempts("calc_error")).repeatCount, 1);
  assert.equal(masteryState(attempts("calc_error", "calc_error")).repeatCount, 2);
  assert.equal(masteryState(attempts("calc_error", "calc_error", "calc_error")).repeatCount, 3);
  // 種類が変わったら数え直す。
  assert.equal(masteryState(attempts("calc_error", "calc_error", "weak_writing")).repeatCount, 1);
  // 間に perfect が入っても、弱点の種類が同じなら続きとして数える。
  assert.equal(masteryState(attempts("calc_error", "perfect", "calc_error")).repeatCount, 2);
});

test("一度も取り組んでいない問題は untouched", () => {
  assert.equal(masteryState([]).untouched, true);
  assert.equal(masteryState(attempts("perfect")).untouched, false);
});

test("弱点の重さは wrong_approach > calc_error = weak_writing > better_solution > perfect", () => {
  assert.ok(WEAKNESS_LEVEL.wrong_approach > WEAKNESS_LEVEL.calc_error);
  assert.equal(WEAKNESS_LEVEL.calc_error, WEAKNESS_LEVEL.weak_writing);
  assert.ok(WEAKNESS_LEVEL.calc_error > WEAKNESS_LEVEL.better_solution);
  assert.ok(WEAKNESS_LEVEL.better_solution > WEAKNESS_LEVEL.perfect);
});

test("維持フェーズ：簡単で安定していた基本問題は外す", () => {
  const easy = { type: "基本例題", difficulty: 2 };
  const state = masteryState(attempts("perfect", "perfect"));
  assert.equal(isMaintenanceTarget(easy, state), false);
});

test("維持フェーズ：複数回間違えた問題・応用的な問題は残す", () => {
  const easy = { type: "基本例題", difficulty: 1 };
  assert.equal(isMaintenanceTarget(easy, masteryState(attempts("calc_error", "wrong_approach", "perfect", "perfect"))), true);
  assert.equal(isMaintenanceTarget({ type: "重要例題", difficulty: 2 }, masteryState(attempts("perfect", "perfect"))), true);
  assert.equal(isMaintenanceTarget({ type: "基本例題", difficulty: 5 }, masteryState(attempts("perfect", "perfect"))), true);
});

test("維持フェーズ：評価が安定しなかった問題は残す", () => {
  const easy = { type: "基本例題", difficulty: 1 };
  const shaky = masteryState(attempts("perfect", "perfect", "calc_error", "perfect", "perfect"));
  assert.equal(shaky.brokenClearCount, 1);
  assert.equal(isMaintenanceTarget(easy, shaky), true);
});
