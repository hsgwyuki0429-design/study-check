// 安全なスケジュール更新（企画書17章）。

import { test } from "node:test";
import assert from "node:assert/strict";

import { validatePlanChanges, operationIdFor, verifyApplied } from "../src/plan-changes.js";
import { AUTO_SOURCE } from "../src/auto-plan.js";

const TODAY = "2026-09-14";

const task = (overrides = {}) => ({
  id: "t1",
  date: TODAY,
  kind: "new",
  questionIds: ["q001"],
  items: [{ itemId: "t1#0", questionId: "q001", goalId: null, originalDate: TODAY, carriedCount: 0 }],
  completed: false,
  pinned: false,
  source: AUTO_SOURCE,
  ...overrides,
});

const context = (overrides = {}) => ({
  today: TODAY,
  plans: [{ date: TODAY, revision: 3, tasks: [task()] }],
  doneItemIds: new Set(),
  protectedItemIds: new Set(),
  questions: new Map([["q001", { id: "q001" }], ["q002", { id: "q002" }]]),
  ...overrides,
});

test("過ぎた日の予定は変えない", () => {
  const result = validatePlanChanges(
    [{ op: "add", date: "2026-09-01", questionId: "q002" }],
    context(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.rejected[0].reason, "past_date");
});

test("完了・固定・実行中のタスクは消さない", () => {
  for (const [label, overrides, extra] of [
    ["完了", { completed: true }, {}],
    ["固定", { pinned: true }, {}],
    ["実行中", {}, { protectedItemIds: new Set(["t1#0"]) }],
  ]) {
    const result = validatePlanChanges(
      [{ op: "remove", date: TODAY, taskIds: ["t1"] }],
      context({ plans: [{ date: TODAY, revision: 1, tasks: [task(overrides)] }], ...extra }),
    );
    assert.equal(result.ok, false, `${label}のタスクが消されようとしている`);
    assert.equal(result.rejected[0].reason, "locked");
  }
});

test("利用者が入れた予定は、自動では消さない", () => {
  const result = validatePlanChanges(
    [{ op: "remove", date: TODAY, taskIds: ["t1"] }],
    context({ plans: [{ date: TODAY, revision: 1, tasks: [task({ source: "app" })] }] }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.rejected[0].reason, "user_owned");
});

test("すでに取り組んだ予定は動かさない", () => {
  const result = validatePlanChanges(
    [{ op: "carryOver", fromDate: TODAY, toDate: "2026-09-15", taskId: "t1", itemIds: ["t1#0"] }],
    context({ doneItemIds: new Set(["t1#0"]) }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.rejected[0].reason, "already_done");
});

test("同じ日に同じ問題を二重に入れない", () => {
  const result = validatePlanChanges(
    [{ op: "add", date: TODAY, questionId: "q001" }],
    context(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.rejected[0].reason, "duplicate");
});

test("問題マスタに無い問題は足さない", () => {
  const result = validatePlanChanges(
    [{ op: "add", date: TODAY, questionId: "q999" }],
    context(),
  );
  assert.equal(result.rejected[0].reason, "unknown_question");
});

test("危ないものだけ落として、残りは通す", () => {
  const result = validatePlanChanges(
    [
      { op: "add", date: "2026-09-01", questionId: "q002" }, // 過去
      { op: "add", date: "2026-09-15", questionId: "q002" }, // 通る
    ],
    context(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.deepEqual(result.touchedDates, ["2026-09-15"]);
});

test("同じ案・同じ状態なら operationId は変わらない（二重適用を防ぐ）", () => {
  const changes = [{ op: "add", date: "2026-09-15", questionId: "q002" }];
  const first = validatePlanChanges(changes, context());
  const second = validatePlanChanges(changes, context());
  assert.equal(first.operationId, second.operationId);
  assert.match(first.operationId, /^autoplan_[0-9a-f]{8}$/);
});

test("案の並び順が違っても、中身が同じなら同じ operationId になる", () => {
  const forward = validatePlanChanges([
    { op: "add", date: "2026-09-15", questionId: "q002" },
    { op: "add", date: "2026-09-16", questionId: "q001" },
  ], context());
  const backward = validatePlanChanges([
    { op: "add", date: "2026-09-16", questionId: "q001" },
    { op: "add", date: "2026-09-15", questionId: "q002" },
  ], context());
  assert.equal(forward.operationId, backward.operationId);
});

test("当てる先の予定が変わったら、operationId も変わる", () => {
  const changes = [{ op: "add", date: TODAY, questionId: "q002" }];
  const before = validatePlanChanges(changes, context());
  const after = validatePlanChanges(changes, context({
    plans: [{ date: TODAY, revision: 4, tasks: [task()] }],
  }));
  assert.notEqual(before.operationId, after.operationId);
});

test("案の中身が変われば operationId も変わる", () => {
  const one = operationIdFor({ today: TODAY, accepted: [{ op: "add", date: TODAY, questionId: "q001" }], revisions: [] });
  const two = operationIdFor({ today: TODAY, accepted: [{ op: "add", date: TODAY, questionId: "q002" }], revisions: [] });
  assert.notEqual(one, two);
});

test("当てたあとに、足した問題が入っているか確かめる", () => {
  const accepted = [{ op: "add", date: "2026-09-15", questionId: "q002" }];
  const missing = verifyApplied(accepted, [{ date: "2026-09-15", tasks: [] }]);
  assert.equal(missing.ok, false);

  const applied = verifyApplied(accepted, [{
    date: "2026-09-15",
    tasks: [task({ id: "t2", date: "2026-09-15", questionIds: ["q002"],
      items: [{ itemId: "t2#0", questionId: "q002", originalDate: "2026-09-15", carriedCount: 0 }] })],
  }]);
  assert.equal(applied.ok, true);
});

test("扱えない操作は落とす", () => {
  const result = validatePlanChanges([{ op: "drop_everything" }], context());
  assert.equal(result.ok, false);
  assert.equal(result.rejected[0].reason, "unknown_op");
});
