// 「その問題を次にいつ復習するか」と「どれくらい急ぐか」を決める。
// 企画書の 6章・7章・8章にあたる。
//
// 日付だけを扱う純粋な処理で、予定にも時間にも触れない。
// 何問置けるかは auto-plan.js が決める。
//
// 周期の決め方（企画書6章）:
//
//   wrong_approach              … 次の学習日。繰り返しても短いまま。
//   calc_error / weak_writing   … 3日後。同じ弱点が続くと 3 → 2 → 翌学習日 と縮める。
//   better_solution             … 復習はするが急がない。
//   perfect（まだクリアでない）  … 2回目の perfect を取りに行く。間は長めでよい。
//   一応クリア                   … 通常フェーズでは復習に出さない（企画書7章）。
//
// 「最近の履歴を優先する」とは、同じ弱点が続いた回数で縮めるということである。
// 遠い昔に1度あった計算ミスで、いまの周期を短くはしない。

import { shiftDateKey } from './datetime.js';
import { masteryState } from './mastery.js';

/** 復習の急ぎ具合。数が小さいほど先に出す（企画書7章の優先順位）。 */
export const REVIEW_TIERS = Object.freeze({
  wrong_approach: 0,   // 方針が違った。最も重い
  procedural: 1,       // 計算ミス・記述が甘い
  better_solution: 2,  // 正解だが、もっと良い解法がある
  unmastered: 3,       // まだクリアしていない（perfect 1回どまり・評価なし）
  maintenance: 4,      // 一応クリアした問題の維持復習
});

export const TIER_LABELS = Object.freeze({
  0: '方針の弱点',
  1: '計算・記述の弱点',
  2: 'より良い解法',
  3: '習得の途中',
  4: '維持の復習',
});

/** calc_error / weak_writing の周期。続けて出るほど縮める（企画書6章の例）。 */
export const PROCEDURAL_INTERVALS = Object.freeze([3, 2, 1]);

/** 種類ごとの基本の間隔（日）。 */
export const BASE_INTERVALS = Object.freeze({
  wrong_approach: 1,
  calc_error: 3,
  weak_writing: 3,
  better_solution: 5,
  // 1回目の perfect のあと。2回目を取りに行くまでの間。
  perfect_once: 7,
  // 一応クリアしたあとの維持復習。
  maintenance: 21,
});

/**
 * 弱点の種類と繰り返し回数から、次の復習までの日数を出す。
 * repeatCount は「その種類が続けて何回目か」（1なら初回）。
 */
export function intervalForWeakness(evaluation, repeatCount = 1) {
  if (evaluation === 'wrong_approach') return BASE_INTERVALS.wrong_approach;
  if (evaluation === 'calc_error' || evaluation === 'weak_writing') {
    const index = Math.max(0, Math.min(PROCEDURAL_INTERVALS.length - 1, repeatCount - 1));
    return PROCEDURAL_INTERVALS[index];
  }
  if (evaluation === 'better_solution') return BASE_INTERVALS.better_solution;
  return BASE_INTERVALS.perfect_once;
}

const tierForEvaluation = (evaluation) => {
  if (evaluation === 'wrong_approach') return REVIEW_TIERS.wrong_approach;
  if (evaluation === 'calc_error' || evaluation === 'weak_writing') return REVIEW_TIERS.procedural;
  if (evaluation === 'better_solution') return REVIEW_TIERS.better_solution;
  return REVIEW_TIERS.unmastered;
};

/**
 * 1問の復習予定を出す。
 *
 *   attempts … その問題への取り組み（古い順）。date を持つ。
 *   today    … 'YYYY-MM-DD'
 *   phase    … 'learning'（通常）か 'maintenance'（全部クリア後・企画書8章）
 *
 * 返すもの:
 *   due        … 復習に出してよいか
 *   dueDate    … 予定している復習日
 *   overdueDays… 予定日をどれだけ過ぎているか（0なら当日）
 *   tier       … 急ぎ具合（REVIEW_TIERS）
 *   reason     … なぜ出すのか。画面にそのまま出せる一言
 *
 * 予定日を過ぎていても「遅れた」とだけ扱い、間違えたことにはしない（企画書12章）。
 */
export function reviewPlanFor(attempts = [], { today, phase = 'learning', state = null } = {}) {
  const mastery = state ?? masteryState(attempts);

  // 一度も取り組んでいない問題は、復習ではなく新規学習の対象。
  if (mastery.untouched) {
    return { due: false, dueDate: null, overdueDays: 0, tier: REVIEW_TIERS.unmastered, state: mastery, reason: '未着手' };
  }

  const last = mastery.lastEvaluatedAt ? String(mastery.lastEvaluatedAt).slice(0, 10) : null;

  if (mastery.cleared) {
    // 通常フェーズでは、クリアした問題を機械的に回さない（企画書7章）。
    if (phase !== 'maintenance') {
      return {
        due: false, dueDate: null, overdueDays: 0, tier: REVIEW_TIERS.maintenance,
        state: mastery, reason: '一応クリア（弱点が残っているあいだは出しません）',
      };
    }
    const dueDate = last ? shiftDateKey(last, BASE_INTERVALS.maintenance) : today;
    return {
      due: dueDate <= today,
      dueDate,
      overdueDays: daysBetween(dueDate, today),
      tier: REVIEW_TIERS.maintenance,
      state: mastery,
      reason: '維持の復習',
    };
  }

  const evaluation = mastery.lastEvaluation;
  const interval = evaluation === 'perfect'
    ? BASE_INTERVALS.perfect_once
    : intervalForWeakness(evaluation, mastery.repeatCount);
  const dueDate = last ? shiftDateKey(last, interval) : today;
  const tier = tierForEvaluation(evaluation);

  return {
    due: dueDate <= today,
    dueDate,
    overdueDays: daysBetween(dueDate, today),
    tier,
    interval,
    state: mastery,
    reason: reasonFor(evaluation, mastery, interval),
  };
}

function reasonFor(evaluation, mastery, interval) {
  if (evaluation === 'wrong_approach') {
    return mastery.repeatCount > 1
      ? `方針を続けて${mastery.repeatCount}回外しているので、次の学習日に復習します`
      : '方針が違ったので、次の学習日に復習します';
  }
  if (evaluation === 'calc_error' || evaluation === 'weak_writing') {
    const label = evaluation === 'calc_error' ? '計算ミス' : '記述の甘さ';
    return mastery.repeatCount > 1
      ? `${label}が続けて${mastery.repeatCount}回なので、周期を${interval}日に縮めました`
      : `${label}のため、${interval}日後に復習します`;
  }
  if (evaluation === 'better_solution') {
    return `より良い解法があったので、${interval}日後に軽く見直します`;
  }
  // perfect 1回どまり。
  return `perfect はあと${Math.max(0, 2 - mastery.perfectStreak)}回で一応クリアです`;
}

/** 復習候補を並べる。急ぎ具合 → 遅れの大きさ → 掲載順。 */
export function compareReviewCandidates(left, right, compareQuestions) {
  return (
    left.tier - right.tier
    || right.overdueDays - left.overdueDays
    || compareQuestions(left.question, right.question)
  );
}

/** from から to までの日数。to のほうが先なら正の数。 */
export function daysBetween(from, to) {
  const left = Date.parse(`${from}T00:00:00Z`);
  const right = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
  return Math.round((right - left) / 86400000);
}
