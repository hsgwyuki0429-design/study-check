// 自動スケジューラと、この端末の保存（IndexedDB）をつなぐ層。
//
// 企画書17章の順序をここで守る。
//
//   現在状態取得 → 変更案生成 → validatePlanChanges → applyTaskChanges →
//   状態再取得 → 結果確認
//
// 判断そのものは auto-plan.js（純粋な処理）が持っている。ここは読み書きだけを行う。

import * as api from './api.js';
import { idb, STORES } from './idb.js';
import { shiftDateKey } from './datetime.js';
import { durationEntriesByStudyDate, recordDateOf } from './records-model.js';
import { itemsOf } from './plan-items.js';
import { buildAutoPlan, AUTO_SOURCE, DEFAULT_HORIZON_DAYS } from './auto-plan.js';
import { validatePlanChanges, verifyApplied } from './plan-changes.js';

/** 自動スケジュールの実行結果を覚えておく場所。 */
export const AUTO_PLAN_KEY = 'autoPlan';

/** 同じ案を二度当てないよう、最近当てた operationId を覚えておく数。 */
const REMEMBERED_OPERATIONS = 20;

/** どこまでさかのぼって未完了の予定を探すか（企画書12章の繰り越し）。 */
export const CARRY_OVER_LOOKBACK_DAYS = 30;

export async function getAutoPlanMeta() {
  const row = await idb.get(STORES.meta, AUTO_PLAN_KEY);
  return { enabled: true, horizonDays: DEFAULT_HORIZON_DAYS, appliedOperations: [], lastRun: null, ...(row?.value ?? {}) };
}

export async function saveAutoPlanMeta(patch) {
  const next = { ...(await getAutoPlanMeta()), ...patch };
  await idb.put(STORES.meta, { key: AUTO_PLAN_KEY, value: next });
  return next;
}

/**
 * いまの学習状態を、auto-plan.js が読める形にまとめて読み出す。
 * 一度にまとめて読むのは、日数ぶん読み直すと重くなるため。
 */
export async function collectPlanningContext({ today = api.studyDayKey(), horizonDays = DEFAULT_HORIZON_DAYS } = {}) {
  const [questionList, records, goals, availability, session, doneItemIds, dayPlanner] = await Promise.all([
    api.listQuestions(),
    api.listRecords(),
    api.getGoals(),
    api.getAvailability(),
    api.getSessionState(),
    api.getDoneItemIds(),
    api.createDayPlanner(),
  ]);

  const questions = new Map(questionList.map((question) => [question.id, question]));

  // 問題ごとの取り組みを、古い順に並べる。復習周期は「最後にいつ、どうだったか」で決まる。
  const attemptsByQuestion = new Map();
  for (const record of [...records].sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)))) {
    if (!attemptsByQuestion.has(record.questionId)) attemptsByQuestion.set(record.questionId, []);
    attemptsByQuestion.get(record.questionId).push({
      date: recordDateOf(record),
      evaluation: record.evaluation ?? null,
      timestamp: record.timestamp,
      inChallenge: Boolean(record.challengeId),
    });
  }

  const spentSecondsByDate = new Map();
  for (const record of records) {
    for (const [date, seconds] of durationEntriesByStudyDate(record)) {
      spentSecondsByDate.set(date, (spentSecondsByDate.get(date) ?? 0) + seconds);
    }
  }

  // 繰り越しの対象を拾うため、過ぎた日もさかのぼって読む。
  const from = shiftDateKey(today, -CARRY_OVER_LOOKBACK_DAYS);
  const to = shiftDateKey(today, horizonDays);
  const plans = await loadPlans(from, to);

  // いま解いているものは動かさない（企画書17章）。
  const protectedItemIds = new Set();
  if (session?.active && session.currentPlanItemId) protectedItemIds.add(session.currentPlanItemId);

  return {
    today,
    horizonDays,
    questions,
    attemptsByQuestion,
    goals: goals.filter((goal) => goal.status === 'active'),
    plans,
    doneItemIds,
    protectedItemIds,
    availability,
    spentSecondsByDate,
    estimateOf: dayPlanner.estimate,
  };
}

async function loadPlans(from, to) {
  const [tasks, meta] = await Promise.all([api.getTasksInRange(from, to), api.getPlanMeta()]);
  const byDate = new Map();
  for (const task of tasks) {
    if (!byDate.has(task.date)) byDate.set(task.date, []);
    byDate.get(task.date).push(task);
  }
  return [...byDate.entries()]
    .map(([date, list]) => ({ date, revision: Number(meta[date]?.revision ?? 0), tasks: list }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * 案を作るだけ。予定は書き換えない。
 * 画面で「こうなります」を見せるときに使う。
 */
export async function previewAutoPlan(options = {}) {
  const context = await collectPlanningContext(options);
  const plan = buildAutoPlan(context);
  const validation = validatePlanChanges(plan.changes, context);
  return { plan, validation, context };
}

/**
 * 案を作り、確かめてから当てる。
 *
 *   dryRun   … true なら当てずに結果だけ返す
 *   force    … true なら、同じ operationId でももう一度当てる
 *
 * 同じ状態で二度呼んでも、二度目は何もしない（企画書17章）。
 */
export async function runAutoPlan({ dryRun = false, force = false, ...options } = {}) {
  const context = await collectPlanningContext(options);
  const plan = buildAutoPlan(context);
  const validation = validatePlanChanges(plan.changes, context);

  const meta = await getAutoPlanMeta();
  const alreadyApplied = meta.appliedOperations.includes(validation.operationId);

  if (dryRun || !validation.ok || (alreadyApplied && !force)) {
    return {
      applied: false,
      reason: !validation.ok ? 'no_change' : alreadyApplied ? 'already_applied' : 'dry_run',
      plan,
      validation,
      notices: plan.notices,
    };
  }

  const applied = await applyPlanChanges(validation.accepted, { today: context.today });

  // 当てたあとの状態を読み直して確かめる。
  const after = await loadPlans(
    shiftDateKey(context.today, -CARRY_OVER_LOOKBACK_DAYS),
    shiftDateKey(context.today, context.horizonDays),
  );
  const verification = verifyApplied(validation.accepted, after);

  await saveAutoPlanMeta({
    lastRun: {
      at: new Date().toISOString(),
      date: context.today,
      operationId: validation.operationId,
      added: applied.added,
      removed: applied.removed,
      carriedOver: applied.carriedOver,
      ok: verification.ok,
    },
    appliedOperations: [validation.operationId, ...meta.appliedOperations].slice(0, REMEMBERED_OPERATIONS),
  });

  return { applied: true, reason: 'applied', plan, validation, verification, counts: applied, notices: plan.notices };
}

/**
 * 確かめ終わった変更を、実際に予定へ書く。
 *
 * 繰り越しを先にやる。繰り越しは元の予定項目をそのまま動かすので、
 * あとから同じ日を組み直すと、動かしたばかりのものを消してしまう。
 */
export async function applyPlanChanges(accepted = [], { today = api.studyDayKey() } = {}) {
  const counts = { added: 0, removed: 0, carriedOver: 0 };

  for (const change of accepted.filter((entry) => entry.op === 'carryOver')) {
    const result = await api.carryOverPlanItems({
      fromDate: change.fromDate,
      taskId: change.taskId,
      itemIds: change.itemIds,
      toDate: change.toDate,
      // 理由は推測しない。単に「未完了」として動かす（企画書12章）。
      reason: 'unspecified',
      kind: 'carry_over',
      actorName: '自動スケジュール',
    });
    if (result.ok) counts.carriedOver += change.itemIds.length;
  }

  // 日ごとにまとめて書く。1日につき1回の書き込みで済ませ、版が細かく動かないようにする。
  const byDate = new Map();
  for (const change of accepted) {
    if (change.op !== 'add' && change.op !== 'remove') continue;
    if (!byDate.has(change.date)) byDate.set(change.date, { add: [], remove: new Set() });
    if (change.op === 'add') byDate.get(change.date).add.push(change);
    else for (const taskId of change.taskIds) byDate.get(change.date).remove.add(taskId);
  }

  for (const [date, group] of [...byDate.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    if (date < today) continue;
    const current = await api.getTodayTasks(date);
    const kept = current.filter((task) => !group.remove.has(task.id));
    counts.removed += current.length - kept.length;

    // すでにその日に入っている問題は足さない（繰り越しで入ったものも含む）。
    const occupied = new Set(kept.flatMap((task) => itemsOf(task).map((item) => item.questionId)));
    const added = [];
    for (const change of group.add) {
      if (occupied.has(change.questionId)) continue;
      occupied.add(change.questionId);
      added.push(autoTaskFor(change, date, kept.length + added.length));
    }
    counts.added += added.length;

    if (!added.length && kept.length === current.length) continue;
    await api.updateTodayTasks([...kept, ...added], date, { updatedBy: AUTO_SOURCE });
  }

  return counts;
}

/** 自動で置く1件ぶんのタスク。1問につき1タスク（企画書3章）。 */
function autoTaskFor(change, date, order) {
  const id = api.uid('task');
  return {
    id,
    date,
    kind: 'new',
    order,
    questionIds: [change.questionId],
    items: [{
      itemId: `${id}#0`,
      questionId: change.questionId,
      goalId: change.goalId ?? null,
      originalDate: date,
      carriedCount: 0,
    }],
    completed: false,
    pinned: false,
    // この印が付いたものだけを、次の自動スケジュールで作り直す。
    source: AUTO_SOURCE,
    // なぜこの問題が置かれたか。画面の説明に使う（表示名ではない）。
    ...(change.reason ? { autoReason: change.reason } : {}),
  };
}
