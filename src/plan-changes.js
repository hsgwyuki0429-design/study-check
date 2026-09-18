// 自動スケジューラが作った案を、予定へ安全に当てる（企画書17章）。
//
// 自動プランナーは直接スケジュールを書き換えない。必ずこの順序を通す。
//
//   現在状態取得 → 変更案生成 → validatePlanChanges → applyTaskChanges →
//   状態再取得 → 結果確認
//
// このファイルは検証（validatePlanChanges）と、同じ案を二度当てないための
// operationId を受け持つ。実際に IndexedDB へ書くのは auto-plan-runner.js。
//
// 守ること:
//   ・いま解いているタスク、完了したタスクは変えない
//   ・利用者が自分で入れた予定は、自動では消さない
//   ・過去の日付は書き換えない（記録は事実なので、あとから予定を足さない）
//   ・同じ案が二度実行されても、二重には当たらない

import { itemsOf } from './plan-items.js';
import { AUTO_SOURCE } from './auto-plan.js';

export const REJECT_REASONS = Object.freeze({
  past_date: '過ぎた日の予定は変えません',
  not_found: 'その予定が見つかりません',
  locked: '完了・実行中の予定は変えません',
  user_owned: '利用者が入れた予定は自動では消しません',
  already_done: 'すでに取り組んだ予定は動かせません',
  duplicate: 'その日にもう同じ問題が入っています',
  unknown_question: '問題マスタにない問題です',
  unknown_op: '扱えない操作です',
});

/**
 * 変更案を1件ずつ確かめる。危ないものだけを落とし、残りは通す。
 *
 *   changes … buildAutoPlan が返した changes
 *   context … { today, plans, doneItemIds, protectedItemIds, questions }
 *
 * 返すもの: { ok, accepted, rejected, operationId, touchedDates }
 * ok は「1件でも当てられるか」。全部落ちたときだけ false になる。
 */
export function validatePlanChanges(changes = [], context = {}) {
  const {
    today,
    plans = [],
    doneItemIds = new Set(),
    protectedItemIds = new Set(),
    questions = new Map(),
  } = context;

  const planByDate = new Map(plans.map((plan) => [plan.date, plan]));
  const taskById = new Map();
  const itemById = new Map();
  for (const plan of plans) {
    for (const task of plan.tasks ?? []) {
      taskById.set(task.id, { task, date: plan.date });
      for (const item of itemsOf(task)) itemById.set(item.itemId, { item, task, date: plan.date });
    }
  }

  // その日にすでに入っている問題。案の中の重複もここで見る。
  const occupied = new Map();
  for (const plan of plans) {
    const set = new Set();
    for (const task of plan.tasks ?? []) {
      for (const item of itemsOf(task)) set.add(item.questionId);
    }
    occupied.set(plan.date, set);
  }
  const occupiedOn = (date) => {
    if (!occupied.has(date)) occupied.set(date, new Set());
    return occupied.get(date);
  };

  const accepted = [];
  const rejected = [];
  const touchedDates = new Set();
  const reject = (change, reason) => rejected.push({ change, reason, message: REJECT_REASONS[reason] ?? reason });

  for (const change of changes) {
    if (change.op === 'remove') {
      if (change.date < today) { reject(change, 'past_date'); continue; }
      const taskIds = (change.taskIds ?? []).filter((taskId) => {
        const found = taskById.get(taskId);
        if (!found) return false;
        if ((found.task.source ?? 'app') !== AUTO_SOURCE) { reject({ ...change, taskIds: [taskId] }, 'user_owned'); return false; }
        if (found.task.completed === true || found.task.pinned === true) { reject({ ...change, taskIds: [taskId] }, 'locked'); return false; }
        const items = itemsOf(found.task);
        if (items.some((item) => doneItemIds.has(item.itemId))) { reject({ ...change, taskIds: [taskId] }, 'already_done'); return false; }
        if (items.some((item) => protectedItemIds.has(item.itemId))) { reject({ ...change, taskIds: [taskId] }, 'locked'); return false; }
        return true;
      });
      if (!taskIds.length) continue;
      for (const taskId of taskIds) {
        for (const item of itemsOf(taskById.get(taskId).task)) occupiedOn(change.date).delete(item.questionId);
      }
      accepted.push({ ...change, taskIds });
      touchedDates.add(change.date);
      continue;
    }

    if (change.op === 'add') {
      if (change.date < today) { reject(change, 'past_date'); continue; }
      if (questions.size && !questions.has(change.questionId)) { reject(change, 'unknown_question'); continue; }
      if (occupiedOn(change.date).has(change.questionId)) { reject(change, 'duplicate'); continue; }
      occupiedOn(change.date).add(change.questionId);
      accepted.push(change);
      touchedDates.add(change.date);
      continue;
    }

    if (change.op === 'carryOver') {
      if (change.toDate < today) { reject(change, 'past_date'); continue; }
      const source = taskById.get(change.taskId);
      if (!source) { reject(change, 'not_found'); continue; }
      if (source.task.completed === true || source.task.pinned === true) { reject(change, 'locked'); continue; }
      const itemIds = (change.itemIds ?? []).filter((itemId) => {
        const found = itemById.get(itemId);
        if (!found) { reject({ ...change, itemIds: [itemId] }, 'not_found'); return false; }
        if (doneItemIds.has(itemId)) { reject({ ...change, itemIds: [itemId] }, 'already_done'); return false; }
        if (protectedItemIds.has(itemId)) { reject({ ...change, itemIds: [itemId] }, 'locked'); return false; }
        if (occupiedOn(change.toDate).has(found.item.questionId)) { reject({ ...change, itemIds: [itemId] }, 'duplicate'); return false; }
        occupiedOn(change.toDate).add(found.item.questionId);
        return true;
      });
      if (!itemIds.length) continue;
      accepted.push({ ...change, itemIds });
      touchedDates.add(change.fromDate);
      touchedDates.add(change.toDate);
      continue;
    }

    reject(change, 'unknown_op');
  }

  const revisions = [...touchedDates].sort().map((date) => `${date}:${planByDate.get(date)?.revision ?? 0}`);

  return {
    ok: accepted.length > 0,
    accepted,
    rejected,
    touchedDates: [...touchedDates].sort(),
    // 案の中身と、当てる先の版から決まる。中身も予定も変わっていなければ同じIDになり、
    // 同じ自動計画イベントが二度走っても二重には当たらない（企画書17章）。
    operationId: operationIdFor({ today, accepted, revisions }),
  };
}

/** 案と当てる先から、毎回同じ値になるIDを作る。乱数も時刻も混ぜない。 */
export function operationIdFor({ today, accepted = [], revisions = [] }) {
  const payload = JSON.stringify({
    today,
    revisions,
    changes: accepted.map((change) => (
      change.op === 'add' ? ['add', change.date, change.questionId]
        : change.op === 'remove' ? ['remove', change.date, [...(change.taskIds ?? [])].sort()]
          : ['carryOver', change.fromDate, change.toDate, change.taskId, [...(change.itemIds ?? [])].sort()]
    )).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
  return `autoplan_${fnv1a(payload)}`;
}

/** 文字列から32bitの値を作る（FNV-1a）。暗号用ではなく、同じ案を見分けるためだけのもの。 */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * 当てたあとの状態を確かめる（企画書17章の「結果確認」）。
 * 予定した問題が実際に入っているか、消したはずのものが残っていないかだけを見る。
 */
export function verifyApplied(accepted = [], plans = []) {
  const byDate = new Map(plans.map((plan) => [plan.date, new Set(
    (plan.tasks ?? []).flatMap((task) => itemsOf(task).map((item) => item.questionId)),
  )]));
  const problems = [];
  for (const change of accepted) {
    if (change.op === 'add' && !byDate.get(change.date)?.has(change.questionId)) {
      problems.push({ change, reason: '足したはずの問題が入っていません' });
    }
    if (change.op === 'carryOver' && !byDate.has(change.toDate)) {
      problems.push({ change, reason: '繰り越し先の予定がありません' });
    }
  }
  return { ok: problems.length === 0, problems };
}
