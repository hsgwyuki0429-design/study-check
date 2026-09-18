// 使い方案内と、この端末の保存をつなぐ層。
//
// 「どこを指すか」「どう進めるか」は tour.js（画面だけを扱う）にある。
// ここは「もう見たか」「その手順は終わったか」を、実際のデータで判断する。

import * as api from './api.js';
import { WEEKDAY_KEYS, WEEKDAY_LABELS, weekdayKeyOf } from './availability.js';
import { loadTasks, refreshToday, render } from './state.js';
import { runAutoPlan } from './auto-plan-runner.js';
import { startTour, stopTour, isRunning } from './tour.js';

/**
 * 手順が終わったかどうかを、本物のデータで確かめる。
 *
 * 画面の見た目では判断しない。「作成ボタンを押した」ではなく
 * 「実際に目標ができた」を条件にする。押したが中身が足りずに
 * 作られなかったとき、先へ進めてしまわないため。
 */
export async function isStepDone(stepId) {
  if (stepId === 'fill-goal') {
    const goals = await api.getGoals();
    return goals.some((goal) => goal.status === 'active' && !goal.needsScopeSetup);
  }
  if (stepId === 'set-minutes') {
    const availability = await api.getAvailability();
    // ひとつでも分数が入っていればよい。0分も「決めた」として扱う。
    return WEEKDAY_KEYS.some((key) => availability.weekly[key] !== null);
  }
  return false;
}

/**
 * 手順を終えたときの後始末。
 *
 * 目標と時間が決まった時点で、予定を組んでおく。これをやらないと、
 * 案内の「ここに今日やる問題が並ぶ」で空のリストを見せることになる。
 * 言ったことと見えているものが食い違うのが、いちばん困る。
 */
async function afterStep(stepId) {
  if (stepId !== 'set-minutes') return;
  try {
    await runAutoPlan();
    await loadTasks();
    await refreshToday();
    render();
  } catch (error) {
    console.warn('案内の途中で予定を組めませんでした:', error.message);
  }
}

/**
 * 実際のデータを見て足す一言。
 *
 * 「ここに今日やる問題が並ぶ」と言ったのに空、という食い違いを黙って見せない。
 * 空になるいちばん多い理由は「今日の曜日に、使える時間を入れていない」である。
 */
export async function noteFor(stepId) {
  if (stepId !== 'todo' && stepId !== 'start') return null;
  const today = api.todayKey();
  const tasks = await api.getTodayTasks(api.studyDayKey());
  if (tasks.length) return null;

  const label = WEEKDAY_LABELS[weekdayKeyOf(today)];
  const capacity = await api.availabilityForDay(today);
  if (capacity.available === null) {
    return `いまは空です。今日は${label}曜日なので、設定 → 学習に使える時間 で`
      + `「${label}」に分を入れると、ここに並びます。`;
  }
  return 'いまは空です。目標の範囲と、使える時間を見直してみてください。';
}

/** 案内を出す。終わったら（やめたときも）もう自動では出さない。 */
export function openTour({ onFinish = () => {} } = {}) {
  if (isRunning()) return;
  startTour({
    isDone: isStepDone,
    onStepDone: afterStep,
    note: noteFor,
    onFinish: async ({ finished }) => {
      await api.saveTourState({
        seen: true,
        ...(finished ? { finishedAt: new Date().toISOString() } : {}),
      });
      onFinish({ finished });
    },
  });
}

/**
 * はじめて開いた人にだけ出す。
 *
 * 案内が出せなくても、アプリそのものは使えなければならない。
 * ここで失敗しても起動は止めない。
 */
export async function runTourIfFirstTime() {
  try {
    const tour = await api.getTourState();
    if (tour.seen) return false;
    openTour();
    return true;
  } catch (error) {
    console.warn('使い方案内を出せませんでした:', error.message);
    return false;
  }
}

export { stopTour };
