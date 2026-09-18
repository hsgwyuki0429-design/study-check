// 自動スケジューラの本体。企画書の3章〜16章をここで組み立てる。
//
// 純粋な処理である。IndexedDB も画面も時計も触らない。入れたものが同じなら、
// 出てくるものも必ず同じになる（企画書19章）。IndexedDB とつなぐのは auto-plan-runner.js、
// 予定へ書き戻すのは plan-changes.js の役目。
//
// 進め方は企画書3章のとおり。
//
//   現在の学習状態を取得 → 未完了タスクを確認 → 復習候補を生成 →
//   各問題の習得状態を判定 → 復習優先度を決定 → 新規問題候補を生成 →
//   目標priorityを考慮 → 利用可能時間へ配置 → 既存スケジュールとの差分を生成
//
// 差分の検証と適用は plan-changes.js に分けてある。ここは案を作るところまでで、
// 予定を直接は書き換えない（企画書17章）。
//
// 1問につき1タスクを基本単位とする（企画書3章）。

import { shiftDateKey } from './datetime.js';
import { availabilityForDate } from './availability.js';
import { compareQuestions } from './question-order.js';
import { itemsOf } from './plan-items.js';
import { masteryState, isMaintenanceTarget } from './mastery.js';
import { REVIEW_TIERS, reviewPlanFor, daysBetween } from './review.js';

/** 何日先まで置くか。先を置きすぎても、そのとおりには進まない。 */
export const DEFAULT_HORIZON_DAYS = 7;

/**
 * 見積もりの確からしさごとの、使ってよい容量の割合（企画書14章）。
 *
 * 見積もりが当てにならない問題ばかりの日は、枠を全部は埋めない。
 * 埋めきってしまうと、少しの読み違いで大量の繰り越しが出る。
 */
export const CONFIDENCE_FILL = Object.freeze({ high: 0.95, medium: 0.9, low: 0.8 });

/** 自動スケジューラが作ったタスクの印。これが付いたものだけを作り直す。 */
export const AUTO_SOURCE = 'auto';

const secondsToMinutes = (seconds) => Math.round(seconds / 60);

/**
 * 自動スケジュールの案を作る。
 *
 *   today              … 'YYYY-MM-DD'（日本時間で判断した「今日」）
 *   horizonDays        … 何日先まで置くか
 *   questions          … Map<questionId, question>
 *   attemptsByQuestion … Map<questionId, attempt[]>（古い順・{ date, evaluation }）
 *   goals              … 正規化済みの目標（進行中のものだけ渡す）
 *   plans              … [{ date, revision, tasks }]（今日より前も含む）
 *   doneItemIds        … 実施済みの予定項目ID
 *   protectedItemIds   … いま解いている予定項目ID（動かさない）
 *   availability       … 学習に使える時間の設定
 *   spentSecondsByDate … Map<date, seconds>（その日にすでに使った時間）
 *   estimateOf         … (questionId, { inChallenge }) => { seconds, confidence, source }
 */
export function buildAutoPlan({
  today,
  horizonDays = DEFAULT_HORIZON_DAYS,
  questions = new Map(),
  attemptsByQuestion = new Map(),
  goals = [],
  plans = [],
  doneItemIds = new Set(),
  protectedItemIds = new Set(),
  availability = null,
  spentSecondsByDate = new Map(),
  estimateOf = () => ({ seconds: 720, confidence: 'low', source: 'default' }),
} = {}) {
  const notices = [];
  const activeGoals = goals.filter((goal) => goal.status === 'active' && !goal.needsScopeSetup);

  /* 1. 現在の学習状態を取得 ------------------------------------------- */

  const states = new Map();
  for (const [questionId] of questions) {
    states.set(questionId, masteryState(attemptsByQuestion.get(questionId) ?? []));
  }
  // 目標の対象に、問題マスタから消えた問題が混じっていても落ちないようにする。
  for (const goal of activeGoals) {
    for (const questionId of goal.questionIds) {
      if (!states.has(questionId)) states.set(questionId, masteryState(attemptsByQuestion.get(questionId) ?? []));
    }
  }

  // 問題ID → その問題を対象にしている目標（priority の小さいものを優先）。
  const goalOf = new Map();
  for (const goal of [...activeGoals].sort((a, b) => a.priority - b.priority)) {
    for (const questionId of goal.questionIds) {
      if (!goalOf.has(questionId)) goalOf.set(questionId, goal);
    }
  }
  const scope = [...goalOf.keys()];

  if (!activeGoals.length) {
    notices.push({
      kind: 'no_goal',
      message: '進行中の目標がありません。新規問題は出せないので、復習だけを置きます。',
    });
  }

  /* 2. フェーズの判定（企画書8章） ------------------------------------ */

  const scopeCleared = scope.length > 0 && scope.every((id) => states.get(id)?.cleared);
  const phase = scopeCleared ? 'maintenance' : 'learning';

  /* 3〜5. 復習候補を生成し、優先度を決める ---------------------------- */

  // 復習は目標の範囲外でも行う。一度取り組んだ問題は、目標を作り直しても忘れる。
  const reviewSource = new Set([...scope, ...attemptsByQuestion.keys()]);
  const reviews = [];
  for (const questionId of reviewSource) {
    const state = states.get(questionId) ?? masteryState(attemptsByQuestion.get(questionId) ?? []);
    const question = questions.get(questionId) ?? null;
    const plan = reviewPlanFor(attemptsByQuestion.get(questionId) ?? [], { today, phase, state });
    if (!plan.due) continue;
    // 維持フェーズでは、代表的な問題だけに絞る（企画書8章）。
    if (plan.tier === REVIEW_TIERS.maintenance && !isMaintenanceTarget(question, state)) continue;
    reviews.push({
      questionId,
      question,
      state,
      tier: plan.tier,
      dueDate: plan.dueDate,
      overdueDays: plan.overdueDays,
      reason: plan.reason,
      goalId: goalOf.get(questionId)?.id ?? null,
    });
  }
  reviews.sort((left, right) => (
    left.tier - right.tier
    || right.overdueDays - left.overdueDays
    || compareQuestions(left.question, right.question)
  ));

  /* 6〜7. 新規問題候補を生成し、目標priorityを考慮する（企画書9章・10章） */

  const newCandidates = newQuestionCandidates({ activeGoals, states, questions, notices });

  /* 8. 利用可能時間へ配置 --------------------------------------------- */

  const dates = [];
  for (let offset = 0; offset < horizonDays; offset += 1) dates.push(shiftDateKey(today, offset));

  const planByDate = new Map(plans.map((plan) => [plan.date, plan]));
  const carried = carryOverCandidates({ plans, today, doneItemIds, questions, estimateOf, goalOf });

  const reviewQueue = [...reviews];
  const newQueue = [...newCandidates];
  const placed = new Set();   // この案ですでに置いた問題ID
  const carriedQueue = [...carried];
  const days = [];
  const changes = [];

  for (const date of dates) {
    const plan = planByDate.get(date) ?? null;
    const capacity = availabilityForDate(availability, date, {
      spentSeconds: spentSecondsByDate.get(date) ?? 0,
      isToday: date === today,
    });

    // すでに置いてある予定のうち、動かさないもの（実施中・完了・利用者が入れたもの）。
    const keep = [];
    const removable = [];
    for (const task of plan?.tasks ?? []) {
      for (const item of itemsOf(task)) {
        if (doneItemIds.has(item.itemId)) continue;
        const entry = {
          itemId: item.itemId,
          taskId: task.id,
          questionId: item.questionId,
          kind: task.kind ?? 'new',
          goalId: item.goalId ?? null,
          estimate: estimateOf(item.questionId, { inChallenge: task.kind === 'challenge' }),
        };
        if (isProtectedTask(task, item, protectedItemIds)) keep.push(entry);
        else removable.push(entry);
      }
    }
    for (const entry of keep) placed.add(entry.questionId);

    // 使える時間が未設定の日には、何も置かない（企画書の availability の決めごと）。
    if (capacity.available === null) {
      days.push({
        date, capacity, budgetMinutes: null, plannedSeconds: 0,
        items: keep.map(toPlannedItem('keep')), skipped: 'not_configured',
      });
      continue;
    }

    const items = keep.map(toPlannedItem('keep'));
    let seconds = keep.reduce((sum, entry) => sum + entry.estimate.seconds, 0);
    const confidences = keep.map((entry) => entry.estimate.confidence);
    const capacitySeconds = capacity.available * 60;

    const fits = (estimate) => {
      // 0分の日には何も置かない。「未設定」とは別で、本人が0分と決めた日である。
      if (capacitySeconds <= 0) return false;
      const budget = capacitySeconds * fillRatio([...confidences, estimate.confidence]);
      if (seconds + estimate.seconds <= budget) return true;
      // 1問だけで枠を超える問題が、どの日にも置けずに消えてしまわないようにする。
      return items.length === 0;
    };
    const take = (entry) => {
      items.push(entry);
      seconds += entry.estimateSeconds;
      confidences.push(entry.confidence);
      placed.add(entry.questionId);
    };

    // 8-1. 繰り越し（企画書12章）。元の予定のまま持ち越す。新しく作り直さない。
    while (carriedQueue.length) {
      const candidate = carriedQueue[0];
      if (placed.has(candidate.questionId)) { carriedQueue.shift(); continue; }
      if (!fits(candidate.estimate)) break;
      carriedQueue.shift();
      take({
        source: 'carry_over',
        itemId: candidate.itemId,
        taskId: candidate.taskId,
        fromDate: candidate.fromDate,
        questionId: candidate.questionId,
        goalId: candidate.goalId,
        estimateSeconds: candidate.estimate.seconds,
        confidence: candidate.estimate.confidence,
        estimateSource: candidate.estimate.source,
        reason: `${candidate.fromDate} の未完了ぶん`,
      });
      changes.push({
        op: 'carryOver',
        fromDate: candidate.fromDate,
        toDate: date,
        taskId: candidate.taskId,
        itemIds: [candidate.itemId],
      });
    }

    // 8-2. 復習。新規学習より必ず先（企画書6章・11章）。
    while (reviewQueue.length) {
      const candidate = reviewQueue[0];
      if (placed.has(candidate.questionId)) { reviewQueue.shift(); continue; }
      const estimate = estimateOf(candidate.questionId, { inChallenge: false });
      if (!fits(estimate)) break;
      reviewQueue.shift();
      take({
        source: 'review',
        questionId: candidate.questionId,
        goalId: candidate.goalId,
        tier: candidate.tier,
        estimateSeconds: estimate.seconds,
        confidence: estimate.confidence,
        estimateSource: estimate.source,
        reason: candidate.reason,
      });
    }

    // 8-3. 新規問題。復習で埋まったら0問でよい（企画書11章）。
    while (newQueue.length) {
      const candidate = newQueue[0];
      if (placed.has(candidate.questionId)) { newQueue.shift(); continue; }
      const estimate = estimateOf(candidate.questionId, { inChallenge: false });
      if (!fits(estimate)) break;
      newQueue.shift();
      take({
        source: 'new',
        questionId: candidate.questionId,
        goalId: candidate.goalId,
        estimateSeconds: estimate.seconds,
        confidence: estimate.confidence,
        estimateSource: estimate.source,
        reason: candidate.reason,
      });
    }

    /* 9. 既存スケジュールとの差分を生成 ------------------------------- */

    const wanted = items.filter((item) => item.source === 'review' || item.source === 'new');
    const reusable = new Map(removable.map((entry) => [entry.questionId, entry]));
    const addQuestionIds = [];
    for (const item of wanted) {
      if (reusable.has(item.questionId)) {
        // すでに同じ問題が置いてある。作り直さずそのまま使う（IDを保つ）。
        const existing = reusable.get(item.questionId);
        item.source = 'keep';
        item.itemId = existing.itemId;
        item.taskId = existing.taskId;
        reusable.delete(item.questionId);
        continue;
      }
      addQuestionIds.push(item.questionId);
    }
    // 自動で置いたのに、もう要らなくなったもの。利用者が入れた予定は消さない。
    const removeTaskIds = [...reusable.values()]
      .filter((entry) => isAutoTask(planByDate.get(date), entry.taskId))
      .map((entry) => entry.taskId);

    if (removeTaskIds.length) changes.push({ op: 'remove', date, taskIds: [...new Set(removeTaskIds)] });
    for (const questionId of addQuestionIds) {
      const item = wanted.find((entry) => entry.questionId === questionId);
      changes.push({
        op: 'add',
        date,
        questionId,
        goalId: item?.goalId ?? null,
        reason: item?.reason ?? null,
      });
    }

    days.push({
      date,
      capacity,
      budgetMinutes: Math.round(capacity.available * fillRatio(confidences)),
      plannedSeconds: seconds,
      plannedMinutes: secondsToMinutes(seconds),
      items,
    });
  }

  /* 置ききれなかったもの ---------------------------------------------- */

  if (carriedQueue.length) {
    notices.push({
      kind: 'carry_over_overflow',
      count: carriedQueue.length,
      message: `未完了の予定が${carriedQueue.length}件、${horizonDays}日先までに収まりませんでした。`
        + ' 学習に使える時間を見直すか、予定を減らしてください。',
    });
  }
  if (reviewQueue.length) {
    notices.push({
      kind: 'review_overflow',
      count: reviewQueue.length,
      message: `復習の候補が${reviewQueue.length}件残っています。復習を優先しているため、新規問題は後ろへ回ります。`,
    });
  }

  notices.push(...deadlineNotices({ activeGoals, states, dates, availability, spentSecondsByDate, today, estimateOf }));
  notices.push(...challengeNotices({ activeGoals, states, questions }));

  return {
    today,
    phase,
    horizonDays,
    days,
    changes,
    notices,
    candidates: {
      reviews,
      newQuestions: newCandidates,
      carryOver: carried,
    },
    leftover: {
      reviews: reviewQueue.length,
      newQuestions: newQueue.length,
      carryOver: carriedQueue.length,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 配置に使う小道具                                                    */
/* ------------------------------------------------------------------ */

const toPlannedItem = (source) => (entry) => ({
  source,
  itemId: entry.itemId,
  taskId: entry.taskId,
  questionId: entry.questionId,
  goalId: entry.goalId,
  estimateSeconds: entry.estimate.seconds,
  confidence: entry.estimate.confidence,
  estimateSource: entry.estimate.source,
  reason: 'すでに置いてある予定',
});

/**
 * 見積もりの確からしさの混ざり具合から、使ってよい容量の割合を出す（企画書14章）。
 * 低い見積もりが混ざるほど、控えめになる。
 */
export function fillRatio(confidences = []) {
  if (!confidences.length) return CONFIDENCE_FILL.high;
  const total = confidences.reduce((sum, value) => sum + (CONFIDENCE_FILL[value] ?? CONFIDENCE_FILL.low), 0);
  return total / confidences.length;
}

/**
 * 動かしてはいけない予定か（企画書17章）。
 * 完了・いま解いているもの・利用者が自分で入れたものは、自動では触らない。
 * 「動かさない印（pinned）」が付いたデータも守る（いまは付ける画面を持たない）。
 */
function isProtectedTask(task, item, protectedItemIds) {
  if (task.completed === true) return true;
  if (task.pinned === true) return true;
  if (protectedItemIds.has(item.itemId)) return true;
  // 自動で置いたもの以外は、利用者が自分で入れたものとみなす。
  return (task.source ?? 'app') !== AUTO_SOURCE;
}

const isAutoTask = (plan, taskId) =>
  (plan?.tasks ?? []).some((task) => task.id === taskId && (task.source ?? 'app') === AUTO_SOURCE);

/**
 * 今日より前に残っている未実施の予定を、繰り越しの候補として集める（企画書12章）。
 *
 * 新しく同じタスクを作るのではなく、元の予定項目をそのまま動かす。
 * 未完了の理由は推測しない。古いものから順に置く。
 */
function carryOverCandidates({ plans, today, doneItemIds, questions, estimateOf, goalOf }) {
  const list = [];
  for (const plan of plans) {
    if (plan.date >= today) continue;
    for (const task of plan.tasks ?? []) {
      if (task.completed === true) continue;
      for (const item of itemsOf(task)) {
        if (doneItemIds.has(item.itemId)) continue;
        list.push({
          itemId: item.itemId,
          taskId: task.id,
          fromDate: plan.date,
          questionId: item.questionId,
          question: questions.get(item.questionId) ?? null,
          goalId: item.goalId ?? goalOf.get(item.questionId)?.id ?? null,
          carriedCount: item.carriedCount ?? 0,
          estimate: estimateOf(item.questionId, { inChallenge: task.kind === 'challenge' }),
        });
      }
    }
  }
  // 古い予定から先に片付ける。同じ日の中は掲載順。
  list.sort((left, right) => left.fromDate.localeCompare(right.fromDate)
    || compareQuestions(left.question, right.question));
  return list;
}

/**
 * 新規問題の候補（企画書9章・10章）。
 *
 * 並びは教科書の掲載順を必ず守る。好きな問題から進めることはしない。
 *
 * EXERCISES は通常の新規問題とは別に扱う（企画書16章）。ここには入れず、
 * 章の例題が仕上がった時点で challenge ready として知らせるだけにする。
 * 何をどれだけ解くかは利用者が決める。
 *
 * priority は点数ではなく「学習段階」として扱う。新規学習は、まだ手つかずの問題が
 * 残っている中でいちばん priority の小さい段階からだけ出す。
 *
 * その段階に未着手の問題がもう無いときは、次の段階へ進む。そこに新規問題が
 * 存在しない以上、待っても何も出てこないためである（復習は priority に関係なく出る）。
 */
function newQuestionCandidates({ activeGoals, states, questions, notices }) {
  const byPriority = new Map();
  for (const goal of activeGoals) {
    if (!byPriority.has(goal.priority)) byPriority.set(goal.priority, []);
    byPriority.get(goal.priority).push(goal);
  }

  for (const priority of [...byPriority.keys()].sort((a, b) => a - b)) {
    const stageGoals = byPriority.get(priority);
    const list = [];
    for (const goal of stageGoals) {
      for (const questionId of goal.questionIds) {
        const state = states.get(questionId);
        if (!state?.untouched) continue;
        const question = questions.get(questionId) ?? null;
        if (question?.type === 'EXERCISES') continue;
        list.push({
          questionId,
          question,
          goalId: goal.id,
          priority,
          reason: `priority ${priority} の新規問題（掲載順）`,
        });
      }
    }
    if (!list.length) continue;

    // 掲載順を守る（企画書9章）。
    list.sort((left, right) => compareQuestions(left.question, right.question));

    const blocked = [...byPriority.keys()].filter((value) => value < priority);
    if (blocked.length) {
      notices.push({
        kind: 'priority_stage',
        priority,
        message: `priority ${blocked.join('・')} に未着手の問題が残っていないため、`
          + `priority ${priority} の新規問題へ進みます（復習は priority に関係なく出ます）。`,
      });
    }
    return list;
  }
  return [];
}

/**
 * 期限に間に合うか（企画書15章）。
 *
 * 足りなくても、期限を延ばしたり範囲を狭めたり習得条件を弱めたりはしない。
 * 事実として足りないことだけを知らせる。
 */
function deadlineNotices({ activeGoals, states, dates, availability, spentSecondsByDate, today, estimateOf }) {
  const notices = [];
  for (const goal of activeGoals) {
    if (!goal.deadline) continue;
    const daysLeft = daysBetween(today, goal.deadline.slice(0, 10));
    if (daysLeft < 0) {
      notices.push({
        kind: 'deadline_passed',
        goalId: goal.id,
        message: `「${goal.title || '目標'}」の期限（${goal.deadline.slice(0, 10)}）を過ぎています。`,
      });
      continue;
    }

    // 残りの問題に「あと1回ずつ」取り組むぶんの時間。
    let remainingSeconds = 0;
    for (const questionId of goal.questionIds) {
      const state = states.get(questionId);
      if (state?.cleared) continue;
      remainingSeconds += estimateOf(questionId, { inChallenge: false }).seconds;
    }

    let capacitySeconds = 0;
    for (let offset = 0; offset <= daysLeft; offset += 1) {
      const date = shiftDateKey(today, offset);
      const capacity = availabilityForDate(availability, date, {
        spentSeconds: spentSecondsByDate.get(date) ?? 0,
        isToday: date === today,
      });
      if (capacity.available === null) continue;
      capacitySeconds += capacity.available * 60;
    }

    if (remainingSeconds > capacitySeconds) {
      notices.push({
        kind: 'deadline_short',
        goalId: goal.id,
        shortMinutes: secondsToMinutes(remainingSeconds - capacitySeconds),
        message: `「${goal.title || '目標'}」は期限まで約${secondsToMinutes(capacitySeconds)}分に対し、`
          + `残りが約${secondsToMinutes(remainingSeconds)}分です。`
          + ' 復習の周期は縮めないので、学習に使える時間か目標の範囲を、自分で見直してください。',
      });
    }
  }
  return notices;
}

/**
 * チャレンジの頃合い（企画書16章）。
 *
 * 章の中の例題が必要な状態に達したら「challenge ready」とだけ知らせる。
 * 何をどれだけ解くかは自動で決めない。利用者が決める。
 */
function challengeNotices({ activeGoals, states, questions }) {
  const byChapter = new Map();
  for (const goal of activeGoals) {
    for (const questionId of goal.questionIds) {
      const question = questions.get(questionId);
      if (!question) continue;
      const key = `${question.subject}｜${question.chapter}`;
      if (!byChapter.has(key)) byChapter.set(key, { examples: [], exercises: [], question });
      const bucket = byChapter.get(key);
      if (question.type === 'EXERCISES') bucket.exercises.push(questionId);
      else bucket.examples.push(questionId);
    }
  }

  const notices = [];
  for (const [key, bucket] of byChapter) {
    if (!bucket.examples.length) continue;
    const ready = bucket.examples.every((id) => states.get(id)?.cleared);
    if (!ready) continue;
    const remaining = bucket.exercises.filter((id) => !states.get(id)?.cleared);
    // 出す問題が残っていないなら、知らせても選びようがない。
    if (!remaining.length) continue;
    notices.push({
      kind: 'challenge_ready',
      chapter: key,
      exerciseCount: remaining.length,
      humanInputRequired: true,
      message: `HUMAN_INPUT_REQUIRED: challenge ready — 「${key}」の例題が一通りクリアできています。`
        + ` チャレンジに出す問題（残り${remaining.length}問の EXERCISES など）と問題数は、自分で選んでください。`,
    });
  }
  return notices;
}
