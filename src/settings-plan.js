// 設定タブの「目標」と「学習に使える時間」のカード。
//
// ここは最小限の操作だけを置く。日々の配分は自動スケジューラ（auto-plan.js）が決めるので、
// 画面では「何を・いつまでに・どこまで」と「1日に何分使えるか」を決められればよい。

import * as api from './api.js';
import { GOAL_COMPLETION_LABELS, GOAL_STATUS_LABELS } from './api.js';
import { WEEKDAY_GROUPS, groupValue } from './availability.js';
import { state, render } from './state.js';
import { el, row, fmtDate } from './ui.js';

let newGoal = null;   // 追加中の目標（開いているときだけ）

const minutesInput = (value, onChange, { placeholder = '未設定' } = {}) => {
  const input = el('input', 'cloud-input time-input');
  input.type = 'number';
  input.min = '0';
  input.max = '1440';
  input.inputMode = 'numeric';
  input.placeholder = placeholder;
  input.value = value === null || value === undefined ? '' : String(value);
  input.onchange = () => onChange(input.value === '' ? null : Math.max(0, Math.round(Number(input.value) || 0)));
  return input;
};

/** 使い方案内が指す先に、目印を付ける。見た目は変えない。 */
const tourTarget = (name, node) => {
  node.dataset.tour = name;
  return node;
};

const button = (label, onClick, cls = 'btn') => {
  const node = el('button', cls, label);
  node.onclick = onClick;
  return node;
};

/* ------------------------------------------------------------------ */
/* 目標                                                                */
/* ------------------------------------------------------------------ */

function goalSummary(goal, progress) {
  if (goal.needsScopeSetup) {
    return '対象が決まっていません（文章だけの古い目標）。対象を選ぶと進み具合を数えられます。';
  }
  const parts = [
    `${progress.satisfied}/${progress.total}問`,
    `残り${progress.remainingMinutes}分${progress.remainingIsComplete ? '' : '（習得までは不確実）'}`,
  ];
  if (progress.unplanned) parts.push(`未配置${progress.unplanned}問`);
  if (goal.deadline) parts.push(`期限 ${fmtDate(goal.deadline)}`);
  return parts.join(' ・ ');
}

async function goalForm(list, rerender) {
  const questions = [...state.questions.values()];
  const chapters = [...new Set(questions.map((question) => question.chapter))];
  const draft = newGoal;

  const titleInput = el('input', 'cloud-input');
  titleInput.placeholder = '例: 2次関数の基本例題を一通り解く';
  titleInput.value = draft.title;
  titleInput.oninput = () => { draft.title = titleInput.value; };

  const deadlineInput = el('input', 'cloud-input');
  deadlineInput.type = 'date';
  deadlineInput.value = draft.deadline;
  deadlineInput.onchange = () => { draft.deadline = deadlineInput.value; };

  // 章も単元も、いくつでもえらべる。
  // ひとつずつしか選べないと「この章とこの章」「この章のうち2〜3単元だけ」という、
  // いちばんよくある決め方ができない。
  draft.chapters = (draft.chapters ?? []).filter((chapter) => chapters.includes(chapter));

  /** チェックボックスの一覧を1つ作る。 */
  const pickerOf = (items, selected, onToggle, allLabel) => {
    const box = el('div', 'section-picker');
    const all = el('label', 'section-choice');
    const allInput = el('input');
    allInput.type = 'checkbox';
    allInput.checked = selected.length === 0;
    allInput.onchange = () => onToggle([]);
    all.append(allInput, el('span', null, allLabel));
    box.append(all);
    for (const { value, label } of items) {
      const choice = el('label', 'section-choice');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = selected.includes(value);
      input.onchange = () => onToggle(input.checked
        ? [...selected, value]
        : selected.filter((entry) => entry !== value));
      choice.append(input, el('span', null, label));
      box.append(choice);
    }
    return box;
  };

  const chapterBox = tourTarget('goal-chapters', pickerOf(
    chapters.map((chapter) => ({
      value: chapter,
      label: `${chapter}（${questions.filter((q) => q.chapter === chapter).length}問）`,
    })),
    draft.chapters,
    (next) => { draft.chapters = next; draft.sections = []; rerender(); },
    `すべての章（${chapters.length}章）`,
  ));

  // 選んだ章に属する単元だけを出す。章を選んでいなければ、絞る相手がいない。
  const sectionsOfChapters = draft.chapters.length
    ? [...new Set(questions
      .filter((question) => draft.chapters.includes(question.chapter))
      .map((question) => question.section))]
    : [];
  draft.sections = (draft.sections ?? []).filter((section) => sectionsOfChapters.includes(section));

  const sectionBox = tourTarget('goal-sections', sectionsOfChapters.length
    ? pickerOf(
      sectionsOfChapters.map((section) => ({
        value: section,
        label: `${section}（${questions.filter((q) => q.section === section
          && draft.chapters.includes(q.chapter)).length}問）`,
      })),
      draft.sections,
      (next) => { draft.sections = next; rerender(); },
      `選んだ章をすべて（${sectionsOfChapters.length}単元）`,
    )
    : el('div', 'row-sub', '章をえらぶと、単元でさらに絞れます。'));

  const completionSelect = el('select');
  completionSelect.append(new Option(GOAL_COMPLETION_LABELS.attempt, 'attempt'));
  completionSelect.append(new Option(GOAL_COMPLETION_LABELS.mastery, 'mastery'));
  completionSelect.value = draft.completionType;
  completionSelect.onchange = () => { draft.completionType = completionSelect.value; };

  const prioritySelect = el('select');
  [1, 2, 3, 4, 5].forEach((value) => prioritySelect.append(new Option(`優先度 ${value}${value === 1 ? '（高）' : value === 5 ? '（低）' : ''}`, String(value))));
  prioritySelect.value = String(draft.priority);
  prioritySelect.onchange = () => { draft.priority = Number(prioritySelect.value); };

  const targets = api.selectQuestions(questions, {
    chapters: draft.chapters?.length ? draft.chapters : undefined,
    sections: draft.sections?.length ? draft.sections : undefined,
  });

  const form = tourTarget('goal-form', el('div', 'plan-form'));
  form.append(
    el('div', 'row-sub', '目標の内容'), titleInput,
    el('div', 'row-sub', '期限（空なら期限なし）'), deadlineInput,
    el('div', 'row-sub', '対象の章'), chapterBox,
    el('div', 'row-sub', '単元でさらに絞る'), sectionBox,
    el('div', 'row-sub', `対象 ${targets.length}問（いま選んでいる範囲の問題が、作成時に確定します）`),
    el('div', 'row-sub', '達成条件'), completionSelect,
    el('div', 'row-sub', '「習得する」は、この目標に結び付いた最新の取り組みが ◯完璧にできた であれば達成とします。'),
    el('div', 'row-sub', '優先順位'), prioritySelect,
  );
  const actions = el('div', 'setting-actions');
  actions.append(
    tourTarget('goal-submit', button('この内容で作成', async () => {
      if (!draft.title.trim()) {
        alert('目標の内容を入れてください');
        return;
      }
      if (!targets.length) {
        alert('対象の問題がありません。範囲を選び直してください。');
        return;
      }
      await api.addGoal({
        title: draft.title.trim(),
        deadline: draft.deadline,
        scope: [...(draft.chapters ?? []), ...(draft.sections ?? [])].join(' / '),
        questionIds: targets.map((question) => question.id),
        completion: draft.completionType === 'mastery'
          ? { type: 'mastery', evaluations: ['perfect'], mode: 'latest' }
          : { type: 'attempt' },
        priority: draft.priority,
      });
      newGoal = null;
      rerender();
    }, 'btn btn-primary')),
    button('やめる', () => {
      newGoal = null;
      rerender();
    }, 'link-btn'),
  );
  form.append(actions);
  list.append(form);
}

export async function renderGoalCard(list, rerender) {
  list.append(el('div', 'section-head', '目標'));
  const goals = await api.getGoals();
  if (!goals.length) {
    list.append(row({ title: 'まだ目標がありません', sub: '「目標を追加」から作れます。', classes: ['row-indent'] }));
  }
  for (const goal of goals) {
    const progress = await api.getGoalProgressLocal(goal);
    const node = row({
      title: goal.title || '（名前なし）',
      sub: goalSummary(goal, progress),
      right: el('span', 'state-pill', GOAL_STATUS_LABELS[goal.status] ?? goal.status),
    });
    list.append(node);
    const detail = el('div', 'row-sub goal-detail');
    detail.textContent = [
      GOAL_COMPLETION_LABELS[goal.completion.type],
      `優先度 ${goal.priority}`,
      goal.startDate ? `開始 ${fmtDate(goal.startDate)}` : null,
    ].filter(Boolean).join(' ・ ');
    list.append(detail);

    const actions = el('div', 'setting-actions');
    actions.append(
      button(goal.status === 'paused' ? '再開する' : '一時停止', async () => {
        await api.updateGoal(goal.id, { status: goal.status === 'paused' ? 'active' : 'paused' });
        rerender();
      }, 'link-btn'),
      button('削除', async () => {
        if (!confirm('この目標を削除します。学習記録は消えません。よろしいですか？')) return;
        await api.deleteGoal(goal.id);
        rerender();
      }, 'link-btn'),
    );
    list.append(actions);
  }

  if (newGoal) {
    await goalForm(list, rerender);
  } else {
    const actions = el('div', 'setting-actions');
    actions.append(tourTarget('goal-add', button('目標を追加', () => {
      newGoal = { title: '', deadline: '', chapters: [], sections: [], completionType: 'attempt', priority: 3 };
      rerender();
    })));
    list.append(actions);
  }
}

/* ------------------------------------------------------------------ */
/* 学習に使える時間                                                    */
/* ------------------------------------------------------------------ */

export async function renderAvailabilityCard(list, rerender) {
  const availability = await api.getAvailability();
  const today = api.todayKey();
  const todayInfo = await api.availabilityForDay(today);
  const plannedToday = await api.plannedMinutesFor(today);

  list.append(el('div', 'section-head', '学習に使える時間'));

  const grid = el('div', 'weekday-grid');
  for (const group of WEEKDAY_GROUPS) {
    const cell = el('label', 'weekday-cell');
    cell.append(el('span', 'weekday-name', group.label));
    cell.append(minutesInput(groupValue(availability.weekly, group.days), async (value) => {
      // その群の曜日をまとめて書き換える。
      await api.saveAvailability({
        weekly: Object.fromEntries(group.days.map((day) => [day, value])),
      });
      rerender();
    }));
    grid.append(cell);
  }
  list.append(tourTarget('weekday-grid', grid));

  const weekdayValue = groupValue(availability.weekly, WEEKDAY_GROUPS[0].days);
  const holidayValue = groupValue(availability.weekly, WEEKDAY_GROUPS[1].days);
  list.append(el('div', 'row-sub row-indent',
    weekdayValue === null && holidayValue === null
      ? '1日に使える分を入れてください。片方だけでも、もう片方に同じ値を使います。'
      : weekdayValue !== null && holidayValue === null
        ? `休日も平日と同じ${weekdayValue}分として扱います。違うなら休日にも入れてください。`
        : weekdayValue === null && holidayValue !== null
          ? `平日も休日と同じ${holidayValue}分として扱います。違うなら平日にも入れてください。`
          : '勉強しない日は 0 と入れてください。空欄は「未設定」で、その日には予定を置きません。'));

  list.append(row({
    title: `今日: 予定 ${plannedToday}分 ／ 使える ${todayInfo.available === null ? '未設定' : `${todayInfo.available}分`}`,
    sub: todayInfo.note,
    classes: ['row-indent'],
  }));
}
