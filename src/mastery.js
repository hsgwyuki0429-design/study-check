// 評価から「その問題が今どういう状態か」を決める。企画書の 4章・5章にあたる。
//
// ここは学習履歴だけを見る純粋な処理で、日付も予定も知らない。
// 「いつ復習するか」は review.js、「今日何を出すか」は auto-plan.js が受け持つ。
//
// 大事な決めごと:
//
//   ・評価が未登録の記録は、正解にも不正解にも数えない。
//     「解いたけれど評価を入れていない」を弱点として扱うと、事実でないものを作ってしまう。
//   ・予定が未実施であることは、この層には入ってこない。
//     実際に記録された評価だけが、その問題の状態である（企画書2章）。

/** 評価の5段階。数が大きいほど重い弱点として扱う。 */
export const WEAKNESS_LEVEL = Object.freeze({
  perfect: 0,
  better_solution: 1,
  calc_error: 2,
  weak_writing: 2,
  wrong_approach: 3,
});

/** 弱点の種類。calc_error と weak_writing は同じ重さだが、繰り返しは別々に数える。 */
export const WEAKNESS_KINDS = Object.freeze(['better_solution', 'calc_error', 'weak_writing', 'wrong_approach']);

/** 「一応クリア」に必要な perfect の回数（企画書5章）。 */
export const CLEAR_PERFECT_COUNT = 2;

export const isWeakness = (evaluation) => WEAKNESS_KINDS.includes(evaluation);
export const weaknessLevelOf = (evaluation) => WEAKNESS_LEVEL[evaluation] ?? 0;
export const isKnownEvaluation = (evaluation) => Object.prototype.hasOwnProperty.call(WEAKNESS_LEVEL, evaluation);

/**
 * 1問の習得状態を出す。attempts は古い順に並んだ、その問題への取り組み。
 *
 * クリア判定（企画書5章）:
 *   perfect が2回そろった時点で「一応クリア」。
 *   そのあとに弱点の評価が付いたら、クリアを解除する。
 *
 * このとき perfect の数え直しも行う。企画書の例
 *
 *     wrong_approach → perfect → perfect → クリア
 *
 * は「間違えたあとに perfect が2回」でクリアになっている。
 * 数え直さないと、一度クリアした問題は間違えたあと perfect 1回で戻ってしまい、
 * この例と食い違う。そのため弱点が出た時点で perfect の数を0に戻す。
 */
export function masteryState(attempts = []) {
  let perfectStreak = 0;    // いまのクリア判定に使っている perfect の数
  let perfectTotal = 0;     // これまでに取れた perfect の総数（参考）
  let cleared = false;
  let clearedAt = null;
  let lastEvaluation = null;
  let lastEvaluatedAt = null;
  let attemptCount = 0;
  let evaluatedCount = 0;
  let mistakeCount = 0;     // 弱点が付いた回数（企画書8章の「複数回間違えた問題」）
  let brokenClearCount = 0; // クリアを取り消した回数（評価が安定しなかった問題）
  let lastWeakness = null;  // 直近の弱点の種類
  let repeatCount = 0;      // その種類が続けて何回目か（復習周期の短縮に使う・企画書6章）
  const kindCounts = Object.fromEntries(WEAKNESS_KINDS.map((kind) => [kind, 0]));

  for (const attempt of attempts) {
    attemptCount += 1;
    const evaluation = attempt?.evaluation ?? null;
    // 評価が未登録の取り組みは、状態を動かさない。無かったことにもしない。
    if (!isKnownEvaluation(evaluation)) continue;
    evaluatedCount += 1;
    lastEvaluation = evaluation;
    lastEvaluatedAt = attempt.date ?? attempt.timestamp ?? lastEvaluatedAt;

    if (evaluation === 'perfect') {
      perfectStreak += 1;
      perfectTotal += 1;
      if (!cleared && perfectStreak >= CLEAR_PERFECT_COUNT) {
        cleared = true;
        clearedAt = lastEvaluatedAt;
      }
      continue;
    }

    // 弱点。クリアを解除し、perfect の数え直しをする。
    mistakeCount += 1;
    kindCounts[evaluation] += 1;
    repeatCount = lastWeakness === evaluation ? repeatCount + 1 : 1;
    lastWeakness = evaluation;
    if (cleared) brokenClearCount += 1;
    cleared = false;
    clearedAt = null;
    perfectStreak = 0;
  }

  return {
    attemptCount,
    evaluatedCount,
    perfectStreak,
    perfectTotal,
    cleared,
    clearedAt,
    lastEvaluation,
    lastEvaluatedAt,
    mistakeCount,
    brokenClearCount,
    kindCounts,
    lastWeakness,
    // 直近の弱点が同じ種類で何回続いているか（1なら今回が初回・0なら弱点なし）。
    repeatCount,
    // まだ一度も評価が付いていない問題。
    untouched: evaluatedCount === 0,
  };
}

/**
 * 維持フェーズで復習し続ける代表的な問題かどうか（企画書8章）。
 *
 * 全部クリアしたあとに全問を回し続けると、学習時間がいくらあっても足りない。
 * 残すのは「忘れると痛いもの」「もともと不安定だったもの」だけにする。
 *
 * 問題どうしのつながり（この例題の考え方を使う応用問題か）は、このアプリの
 * 問題マスタでは分からない。代わりに、誌面で応用側に置かれている種類と
 * 難易度を手がかりにする。推測で関連を作って理由に書くことはしない。
 */
export function isMaintenanceTarget(question, state) {
  if (!state) return false;
  // 過去に複数回つまずいた問題、方針を外した問題、評価が安定しなかった問題。
  if (state.mistakeCount >= 2) return true;
  if ((state.kindCounts?.wrong_approach ?? 0) >= 2) return true;
  if (state.brokenClearCount >= 1) return true;

  const difficulty = Number(question?.difficulty);
  const type = question?.type ?? '';
  // 少し応用的な問題（重要例題・演習例題・EXERCISES、または難易度4以上）。
  const advancedType = type === '重要例題' || type === '演習例題' || type === 'EXERCISES';
  if (advancedType || (Number.isFinite(difficulty) && difficulty >= 4)) return true;

  // 簡単で、ほとんど失敗せず、安定して perfect だった基本問題は外す。
  return false;
}
