// 復習周期と優先順位（企画書6章・7章・8章）。

import { test } from "node:test";
import assert from "node:assert/strict";

import { reviewPlanFor, intervalForWeakness, REVIEW_TIERS, BASE_INTERVALS } from "../src/review.js";

const at = (date, evaluation) => ({ date, evaluation });

test("wrong_approach は次の学習日に復習する", () => {
  assert.equal(intervalForWeakness("wrong_approach", 1), 1);
  // 繰り返しても短いまま。
  assert.equal(intervalForWeakness("wrong_approach", 3), 1);

  const plan = reviewPlanFor([at("2026-09-10", "wrong_approach")], { today: "2026-09-11" });
  assert.equal(plan.dueDate, "2026-09-11");
  assert.equal(plan.due, true);
  assert.equal(plan.tier, REVIEW_TIERS.wrong_approach);
});

test("calc_error / weak_writing は 3日 → 2日 → 翌学習日 と縮む（企画書6章の例）", () => {
  assert.equal(intervalForWeakness("calc_error", 1), 3);
  assert.equal(intervalForWeakness("calc_error", 2), 2);
  assert.equal(intervalForWeakness("calc_error", 3), 1);
  assert.equal(intervalForWeakness("calc_error", 9), 1);
  assert.equal(intervalForWeakness("weak_writing", 1), 3);
  assert.equal(intervalForWeakness("weak_writing", 2), 2);
});

test("同じ弱点が続くと、実際に復習日が近づく", () => {
  const once = reviewPlanFor([at("2026-09-10", "calc_error")], { today: "2026-09-10" });
  assert.equal(once.dueDate, "2026-09-13");

  const thrice = reviewPlanFor(
    [at("2026-09-01", "calc_error"), at("2026-09-05", "calc_error"), at("2026-09-10", "calc_error")],
    { today: "2026-09-10" },
  );
  assert.equal(thrice.dueDate, "2026-09-11", "3回目以降は翌学習日にならなかった");
});

test("weak_writing は calc_error と同じ重さで扱う", () => {
  const calc = reviewPlanFor([at("2026-09-10", "calc_error")], { today: "2026-09-13" });
  const writing = reviewPlanFor([at("2026-09-10", "weak_writing")], { today: "2026-09-13" });
  assert.equal(calc.tier, writing.tier);
  assert.equal(calc.dueDate, writing.dueDate);
});

test("better_solution は復習に出すが、弱点より後ろに回す", () => {
  const light = reviewPlanFor([at("2026-09-01", "better_solution")], { today: "2026-09-20" });
  assert.equal(light.due, true);
  assert.ok(light.tier > REVIEW_TIERS.procedural, "better_solution が計算ミスより先に来ている");
  assert.ok(light.tier < REVIEW_TIERS.unmastered);
});

test("優先順位は 弱点 → 未習得 → 維持（企画書7章）", () => {
  assert.ok(REVIEW_TIERS.wrong_approach < REVIEW_TIERS.procedural);
  assert.ok(REVIEW_TIERS.procedural < REVIEW_TIERS.better_solution);
  assert.ok(REVIEW_TIERS.better_solution < REVIEW_TIERS.unmastered);
  assert.ok(REVIEW_TIERS.unmastered < REVIEW_TIERS.maintenance);
});

test("通常フェーズでは、クリアした問題を復習に出さない（企画書7章）", () => {
  const cleared = [at("2026-09-01", "perfect"), at("2026-09-02", "perfect")];
  const plan = reviewPlanFor(cleared, { today: "2026-12-01" });
  assert.equal(plan.due, false);
  assert.match(plan.reason, /一応クリア/);
});

test("維持フェーズでは、クリアした問題も間を置いて出す（企画書8章）", () => {
  const cleared = [at("2026-09-01", "perfect"), at("2026-09-02", "perfect")];
  const soon = reviewPlanFor(cleared, { today: "2026-09-05", phase: "maintenance" });
  assert.equal(soon.due, false, "クリア直後から維持復習に出てしまっている");

  const later = reviewPlanFor(cleared, { today: "2026-12-01", phase: "maintenance" });
  assert.equal(later.due, true);
  assert.equal(later.tier, REVIEW_TIERS.maintenance);
});

test("perfect 1回どまりの問題は、2回目を取りに行く", () => {
  const plan = reviewPlanFor([at("2026-09-01", "perfect")], { today: "2026-09-01" });
  assert.equal(plan.dueDate, "2026-09-08");
  assert.equal(plan.tier, REVIEW_TIERS.unmastered);
  assert.equal(BASE_INTERVALS.perfect_once, 7);
});

test("未着手の問題は復習ではない", () => {
  const plan = reviewPlanFor([], { today: "2026-09-10" });
  assert.equal(plan.due, false);
  assert.equal(plan.reason, "未着手");
});

test("予定日を過ぎた分は、遅れた日数だけを持つ（間違い扱いにしない）", () => {
  const plan = reviewPlanFor([at("2026-09-01", "calc_error")], { today: "2026-09-10" });
  assert.equal(plan.dueDate, "2026-09-04");
  assert.equal(plan.overdueDays, 6);
  assert.equal(plan.due, true);
});

test("評価が未登録の取り組みは、周期の起点にしない", () => {
  const plan = reviewPlanFor(
    [at("2026-09-01", "wrong_approach"), at("2026-09-20", null)],
    { today: "2026-09-21" },
  );
  // 最後に評価が付いたのは 9-01。そこから1日後が予定日。
  assert.equal(plan.dueDate, "2026-09-02");
  assert.equal(plan.tier, REVIEW_TIERS.wrong_approach);
});
