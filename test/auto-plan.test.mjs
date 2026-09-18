// 自動スケジューラ全体（企画書3章・9章〜16章・19章）。

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAutoPlan, fillRatio, AUTO_SOURCE } from "../src/auto-plan.js";
import { normalizeGoal } from "../src/goals.js";

const TODAY = "2026-09-14";

/** 教科書の掲載順に並んだ例題を作る。 */
function makeQuestions(count, overrides = {}) {
  const questions = new Map();
  for (let index = 1; index <= count; index += 1) {
    const id = `q${String(index).padStart(3, "0")}`;
    questions.set(id, {
      id,
      subject: "数学I",
      subjectOrder: 1,
      chapter: "数と式",
      chapterOrder: 1,
      section: "多項式",
      sectionOrder: 1,
      type: "基本例題",
      number: index,
      label: `基本例題${index}`,
      difficulty: 2,
      ...overrides,
    });
  }
  return questions;
}

const goal = (overrides = {}) => normalizeGoal({
  id: "g1",
  title: "1章",
  questionIds: [],
  priority: 3,
  status: "active",
  ...overrides,
});

/** すべての問題を、決まった時間・確からしさで見積もる。 */
const estimateEvery = (minutes, confidence = "high") =>
  () => ({ seconds: minutes * 60, confidence, source: "history" });

/** 平日も休日も同じ分数が使える設定。 */
const availabilityOf = (minutes) => ({
  weekly: { sun: minutes, mon: minutes, tue: minutes, wed: minutes, thu: minutes, fri: minutes, sat: minutes },
  overrides: {},
  todayRemaining: null,
  reserveMinutes: 0,
  timerIncludesReview: true,
  reviewOverheadSeconds: 0,
});

const base = (overrides = {}) => ({
  today: TODAY,
  horizonDays: 3,
  questions: makeQuestions(10),
  attemptsByQuestion: new Map(),
  goals: [goal({ questionIds: [...makeQuestions(10).keys()] })],
  plans: [],
  doneItemIds: new Set(),
  protectedItemIds: new Set(),
  availability: availabilityOf(60),
  spentSecondsByDate: new Map(),
  estimateOf: estimateEvery(10),
  ...overrides,
});

const questionsOn = (plan, date) =>
  plan.days.find((day) => day.date === date).items.map((item) => item.questionId);

/* ------------------------------------------------------------------ */

test("同じ状態なら、同じ予定が出る（企画書19章）", () => {
  const first = buildAutoPlan(base());
  const second = buildAutoPlan(base());
  assert.deepEqual(first.days.map((day) => questionsOn(first, day.date)),
    second.days.map((day) => questionsOn(second, day.date)));
  assert.deepEqual(first.changes, second.changes);
});

test("新規問題は教科書の掲載順を守る（企画書9章）", () => {
  const plan = buildAutoPlan(base());
  const placed = plan.days.flatMap((day) => questionsOn(plan, day.date));
  assert.deepEqual(placed, [...placed].sort());
  assert.deepEqual(questionsOn(plan, TODAY).slice(0, 3), ["q001", "q002", "q003"]);
});

test("使える時間を超えて詰め込まない（企画書13章・14章）", () => {
  // 60分・見積もりは確かなので 95%＝57分。10分の問題は5問まで。
  const plan = buildAutoPlan(base());
  assert.equal(questionsOn(plan, TODAY).length, 5);
});

test("見積もりが当てにならない日は、枠を控えめに使う（企画書14章）", () => {
  const confident = buildAutoPlan(base({ estimateOf: estimateEvery(10, "high") }));
  const unsure = buildAutoPlan(base({ estimateOf: estimateEvery(10, "low") }));
  assert.ok(questionsOn(unsure, TODAY).length < questionsOn(confident, TODAY).length,
    "確からしさが低くても同じ数だけ詰め込んでいる");
  assert.equal(fillRatio(["high"]), 0.95);
  assert.equal(fillRatio(["low"]), 0.8);
});

test("復習は新規学習より先に置く（企画書6章・11章）", () => {
  const attempts = new Map([
    ["q007", [{ date: "2026-09-13", evaluation: "wrong_approach" }]],
    ["q009", [{ date: "2026-09-10", evaluation: "calc_error" }]],
  ]);
  const plan = buildAutoPlan(base({ attemptsByQuestion: attempts }));
  const today = questionsOn(plan, TODAY);
  assert.deepEqual(today.slice(0, 2), ["q007", "q009"], "復習が先頭に来ていない");
  assert.deepEqual(today.slice(2), ["q001", "q002", "q003"]);
});

test("復習だけで時間が埋まる日は、新規問題が0問でよい（企画書11章）", () => {
  const attempts = new Map();
  for (let index = 1; index <= 8; index += 1) {
    attempts.set(`q${String(index).padStart(3, "0")}`, [{ date: "2026-09-13", evaluation: "wrong_approach" }]);
  }
  const plan = buildAutoPlan(base({ attemptsByQuestion: attempts }));
  const today = questionsOn(plan, TODAY);
  assert.equal(today.length, 5);
  assert.ok(today.every((id) => attempts.has(id)), "新規問題が復習より先に入っている");
});

test("方針の弱点は、計算ミスより先に出る（企画書7章）", () => {
  const attempts = new Map([
    // 計算ミスは3日後（9-13）が予定日。今日は1日遅れている。
    ["q002", [{ date: "2026-09-10", evaluation: "calc_error" }]],
    // 方針違いは翌日（9-14）が予定日。遅れは無いが、弱点としては重い。
    ["q008", [{ date: "2026-09-13", evaluation: "wrong_approach" }]],
  ]);
  // 25分・見積もり10分ずつ。95%＝23.75分なので、この日には2問だけ入る。
  const plan = buildAutoPlan(base({ attemptsByQuestion: attempts, availability: availabilityOf(25) }));
  assert.deepEqual(questionsOn(plan, TODAY), ["q008", "q002"]);
});

test("クリアした問題は、弱点が残っているあいだ復習に出ない（企画書7章）", () => {
  const attempts = new Map([
    ["q001", [{ date: "2026-08-01", evaluation: "perfect" }, { date: "2026-08-05", evaluation: "perfect" }]],
    ["q002", [{ date: "2026-09-13", evaluation: "wrong_approach" }]],
  ]);
  const plan = buildAutoPlan(base({ attemptsByQuestion: attempts }));
  const today = questionsOn(plan, TODAY);
  assert.equal(today.includes("q001"), false, "クリア済みの問題が復習に出ている");
  assert.equal(today[0], "q002");
});

test("目標の priority は、新規学習の順番を決める（企画書10章）", () => {
  const questions = makeQuestions(10);
  const goals = [
    goal({ id: "g3", priority: 3, questionIds: ["q001", "q002"] }),
    goal({ id: "g4", priority: 4, questionIds: ["q005", "q006"] }),
  ];
  const plan = buildAutoPlan(base({ questions, goals, availability: availabilityOf(60) }));
  const today = questionsOn(plan, TODAY);
  assert.deepEqual(today.slice(0, 2), ["q001", "q002"], "priority 3 より先に 4 へ進んでいる");
  assert.equal(today.includes("q005"), false, "priority 3 が残っているのに 4 の新規問題に進んだ");
});

test("priority 4 の復習と priority 3 の新規学習は同じ日に入れてよい（企画書10章）", () => {
  const questions = makeQuestions(10);
  const goals = [
    goal({ id: "g3", priority: 3, questionIds: ["q001", "q002"] }),
    goal({ id: "g4", priority: 4, questionIds: ["q005", "q006"] }),
  ];
  const attempts = new Map([["q005", [{ date: "2026-09-13", evaluation: "wrong_approach" }]]]);
  const plan = buildAutoPlan(base({ questions, goals, attemptsByQuestion: attempts }));
  const today = questionsOn(plan, TODAY);
  assert.equal(today[0], "q005", "priority 4 の復習が止められている");
  assert.ok(today.includes("q001"), "priority 3 の新規学習が止まっている");
});

test("priority の段階に未着手の問題が無ければ、次の段階へ進む", () => {
  const questions = makeQuestions(10);
  const goals = [
    goal({ id: "g3", priority: 3, questionIds: ["q001"] }),
    goal({ id: "g4", priority: 4, questionIds: ["q005", "q006"] }),
  ];
  // priority 3 の問題は着手済み（まだクリアではない）。
  const attempts = new Map([["q001", [{ date: "2026-09-13", evaluation: "perfect" }]]]);
  const plan = buildAutoPlan(base({ questions, goals, attemptsByQuestion: attempts }));
  const today = questionsOn(plan, TODAY);
  assert.ok(today.includes("q005"), "次の段階の新規問題へ進めていない");
  assert.ok(plan.notices.some((notice) => notice.kind === "priority_stage"));
});

test("未完了の予定は、元のまま翌日以降へ繰り越す（企画書12章）", () => {
  const plans = [{
    date: "2026-09-12",
    revision: 1,
    tasks: [{
      id: "task-old",
      date: "2026-09-12",
      kind: "new",
      questionIds: ["q004"],
      items: [{ itemId: "task-old#0", questionId: "q004", goalId: "g1", originalDate: "2026-09-12", carriedCount: 0 }],
      completed: false,
      source: AUTO_SOURCE,
    }],
  }];
  const plan = buildAutoPlan(base({ plans }));
  assert.equal(questionsOn(plan, TODAY)[0], "q004", "未完了ぶんが先頭に来ていない");

  const carry = plan.changes.find((change) => change.op === "carryOver");
  assert.deepEqual(carry, {
    op: "carryOver", fromDate: "2026-09-12", toDate: TODAY, taskId: "task-old", itemIds: ["task-old#0"],
  });
  // 新しい同じタスクを作らない（元の itemId のまま動かす）。
  assert.equal(plan.changes.some((change) => change.op === "add" && change.questionId === "q004"), false);
});

test("固定した予定と、いま解いている予定は動かさない（企画書17章）", () => {
  const plans = [{
    date: TODAY,
    revision: 2,
    tasks: [
      { id: "pinned", date: TODAY, kind: "new", questionIds: ["q009"], pinned: true, source: AUTO_SOURCE,
        items: [{ itemId: "pinned#0", questionId: "q009", originalDate: TODAY, carriedCount: 0 }] },
      { id: "running", date: TODAY, kind: "new", questionIds: ["q010"], source: AUTO_SOURCE,
        items: [{ itemId: "running#0", questionId: "q010", originalDate: TODAY, carriedCount: 0 }] },
    ],
  }];
  const plan = buildAutoPlan(base({ plans, protectedItemIds: new Set(["running#0"]) }));
  const removed = plan.changes.filter((change) => change.op === "remove").flatMap((change) => change.taskIds);
  assert.deepEqual(removed, [], "固定・実行中の予定を消そうとしている");
  const today = questionsOn(plan, TODAY);
  assert.ok(today.includes("q009") && today.includes("q010"));
});

test("利用者が自分で入れた予定は、自動では消さない", () => {
  const plans = [{
    date: TODAY,
    revision: 1,
    tasks: [{ id: "mine", date: TODAY, kind: "new", questionIds: ["q010"], source: "app",
      items: [{ itemId: "mine#0", questionId: "q010", originalDate: TODAY, carriedCount: 0 }] }],
  }];
  const plan = buildAutoPlan(base({ plans }));
  assert.deepEqual(plan.changes.filter((change) => change.op === "remove"), []);
});

test("自動で置いた予定のうち、要らなくなったものだけを外す", () => {
  const plans = [{
    date: TODAY,
    revision: 1,
    tasks: [{ id: "stale", date: TODAY, kind: "new", questionIds: ["q010"], source: AUTO_SOURCE,
      items: [{ itemId: "stale#0", questionId: "q010", originalDate: TODAY, carriedCount: 0 }] }],
  }];
  // 60分ぶんは q001〜q005 で埋まるので、q010 は今日の予定から外れる。
  const plan = buildAutoPlan(base({ plans }));
  const removed = plan.changes.filter((change) => change.op === "remove").flatMap((change) => change.taskIds);
  assert.deepEqual(removed, ["stale"]);
});

test("使える時間が未設定の日には、何も置かない", () => {
  const availability = availabilityOf(60);
  availability.overrides = { "2026-09-15": null };
  availability.weekly.tue = null; // 2026-09-15 は火曜
  const plan = buildAutoPlan(base({ availability }));
  const day = plan.days.find((entry) => entry.date === "2026-09-15");
  assert.equal(day.skipped, "not_configured");
  assert.deepEqual(day.items, []);
});

test("0分と決めた日にも置かない（未設定とは別もの）", () => {
  const availability = availabilityOf(60);
  availability.overrides = { "2026-09-15": 0 };
  const plan = buildAutoPlan(base({ availability }));
  const day = plan.days.find((entry) => entry.date === "2026-09-15");
  assert.equal(day.capacity.available, 0);
  assert.deepEqual(day.items, []);
});

test("全部クリアすると、維持フェーズへ移る（企画書8章）", () => {
  const questions = makeQuestions(4);
  const attempts = new Map();
  for (const id of questions.keys()) {
    attempts.set(id, [
      { date: "2026-06-01", evaluation: "perfect" },
      { date: "2026-06-05", evaluation: "perfect" },
    ]);
  }
  const plan = buildAutoPlan(base({
    questions,
    goals: [goal({ questionIds: [...questions.keys()] })],
    attemptsByQuestion: attempts,
  }));
  assert.equal(plan.phase, "maintenance");
});

test("維持フェーズでは、簡単で安定していた基本問題を外す（企画書8章）", () => {
  const questions = makeQuestions(4);
  questions.get("q003").type = "重要例題";
  const attempts = new Map();
  for (const id of questions.keys()) {
    attempts.set(id, [
      { date: "2026-06-01", evaluation: "perfect" },
      { date: "2026-06-05", evaluation: "perfect" },
    ]);
  }
  const plan = buildAutoPlan(base({
    questions,
    goals: [goal({ questionIds: [...questions.keys()] })],
    attemptsByQuestion: attempts,
  }));
  const today = questionsOn(plan, TODAY);
  assert.deepEqual(today, ["q003"], "維持フェーズで全問を回そうとしている");
});

test("期限に間に合わないときは、警告するだけで予定は緩めない（企画書15章）", () => {
  const questions = makeQuestions(20);
  const plan = buildAutoPlan(base({
    questions,
    horizonDays: 2,
    goals: [goal({ questionIds: [...questions.keys()], deadline: "2026-09-16" })],
    availability: availabilityOf(30),
    estimateOf: estimateEvery(15),
  }));
  const warning = plan.notices.find((notice) => notice.kind === "deadline_short");
  assert.ok(warning, "期限が足りないのに警告が無い");
  assert.ok(warning.shortMinutes > 0);
  // 枠を勝手に増やしていない。
  for (const day of plan.days) assert.ok(day.plannedMinutes <= day.capacity.available);
});

test("章の例題をすべてクリアすると challenge ready を知らせる（企画書16章）", () => {
  const questions = makeQuestions(3);
  questions.set("ex1", {
    id: "ex1", subject: "数学I", subjectOrder: 1, chapter: "数と式", chapterOrder: 1,
    section: "多項式", sectionOrder: 1, type: "EXERCISES", number: 1, difficulty: 3,
  });
  const attempts = new Map();
  for (const id of ["q001", "q002", "q003"]) {
    attempts.set(id, [
      { date: "2026-06-01", evaluation: "perfect" },
      { date: "2026-06-05", evaluation: "perfect" },
    ]);
  }
  const plan = buildAutoPlan(base({
    questions,
    goals: [goal({ questionIds: [...questions.keys()] })],
    attemptsByQuestion: attempts,
  }));
  const ready = plan.notices.find((notice) => notice.kind === "challenge_ready");
  assert.ok(ready, "challenge ready が出ていない");
  assert.equal(ready.humanInputRequired, true);
  assert.match(ready.message, /HUMAN_INPUT_REQUIRED: challenge ready/);
  // チャレンジの中身は自動で決めない。
  assert.equal(plan.changes.some((change) => change.op === "add" && change.questionId === "ex1"), false);
});

test("目標が無いときは、復習だけを置いて知らせる", () => {
  const attempts = new Map([["q002", [{ date: "2026-09-13", evaluation: "wrong_approach" }]]]);
  const plan = buildAutoPlan(base({ goals: [], attemptsByQuestion: attempts }));
  assert.deepEqual(questionsOn(plan, TODAY), ["q002"]);
  assert.ok(plan.notices.some((notice) => notice.kind === "no_goal"));
});

test("同じ問題を、同じ案の中で二度置かない", () => {
  const attempts = new Map([["q001", [{ date: "2026-09-13", evaluation: "wrong_approach" }]]]);
  const plan = buildAutoPlan(base({ attemptsByQuestion: attempts, horizonDays: 5 }));
  const placed = plan.days.flatMap((day) => questionsOn(plan, day.date));
  assert.equal(new Set(placed).size, placed.length);
});
