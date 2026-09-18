// 設定タブの「自動スケジュール」カード。
//
// ここは操作と説明だけを置く。何をどう決めるかは auto-plan.js が持っている。
// 押す前に「こうなります」を見せてから当てる（企画書17章）。

import * as api from './api.js';
import { el, row } from './ui.js';
import { qLabel } from './state.js';
import { TIER_LABELS } from './review.js';
import { DEFAULT_HORIZON_DAYS } from './auto-plan.js';
import { getAutoPlanMeta, saveAutoPlanMeta, previewAutoPlan, runAutoPlan } from './auto-plan-runner.js';

const HORIZON_CHOICES = [3, 7, 14];

const fmtDay = (key) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

export async function renderAutoPlanCard(list, rerender) {
  const meta = await getAutoPlanMeta();

  list.append(row({
    title: '何をしているか',
    sub: '学習履歴・評価・目標・使える時間から、その日に取り組む問題を自動で決めます。'
      + ' 同じ状態なら、いつ押しても同じ予定になります。',
  }));

  /* 入り切り ---------------------------------------------------------- */

  const toggle = el('div', 'setting');
  const head = el('div', 'setting-head');
  head.append(el('div', 'row-title', 'アプリを開いたときに組み直す'));
  head.append(el('div', 'row-sub', meta.enabled
    ? '開くたびに、その時点でいちばん必要な問題が並びます。'
    : '切っています。下の「今すぐ組み直す」を押したときだけ動きます。'));
  toggle.append(head);
  const choices = el('div', 'choices');
  for (const [value, label] of [[true, '入'], [false, '切']]) {
    const button = el('button', 'choice', label);
    button.setAttribute('aria-selected', String(meta.enabled === value));
    button.onclick = async () => {
      await saveAutoPlanMeta({ enabled: value });
      rerender();
    };
    choices.append(button);
  }
  toggle.append(choices);
  list.append(toggle);

  /* 何日先まで -------------------------------------------------------- */

  const horizon = el('div', 'setting');
  const horizonHead = el('div', 'setting-head');
  horizonHead.append(el('div', 'row-title', '何日先まで置くか'));
  horizonHead.append(el('div', 'row-sub', '先を置きすぎても、そのとおりには進みません。'));
  horizon.append(horizonHead);
  const horizonChoices = el('div', 'choices');
  for (const days of HORIZON_CHOICES) {
    const button = el('button', 'choice', `${days}日`);
    button.setAttribute('aria-selected', String((meta.horizonDays ?? DEFAULT_HORIZON_DAYS) === days));
    button.onclick = async () => {
      await saveAutoPlanMeta({ horizonDays: days });
      rerender();
    };
    horizonChoices.append(button);
  }
  horizon.append(horizonChoices);
  list.append(horizon);

  /* いまの案 ---------------------------------------------------------- */

  const { plan, validation } = await previewAutoPlan({ horizonDays: meta.horizonDays ?? DEFAULT_HORIZON_DAYS });

  list.append(row({
    title: 'いまの段階',
    sub: plan.phase === 'maintenance'
      ? '維持フェーズ（対象の問題は一通りクリア。代表的な問題だけを間を置いて復習します）'
      : '習得フェーズ（弱点 → 未習得 → 安定した問題 の順に出します）',
  }));

  for (const day of plan.days) {
    const capacity = day.capacity.available === null
      ? '使える時間が未設定'
      : `予定${day.plannedMinutes ?? 0}分 / 使える${day.capacity.available}分`;
    const detail = day.items.length
      ? day.items.map((item) => qLabel(item.questionId)).join('・')
      : (day.capacity.available === null ? '時間を設定すると予定が入ります' : '予定なし');
    list.append(row({
      title: `${fmtDay(day.date)}（${capacity}）`,
      sub: detail,
      classes: ['row-indent'],
    }));
  }

  /* なぜその問題なのか ------------------------------------------------ */

  const todayItems = plan.days[0]?.items ?? [];
  if (todayItems.length) {
    list.append(row({ title: '今日の理由', sub: 'なぜその問題が選ばれたか' }));
    for (const item of todayItems) {
      const tier = item.tier === undefined ? null : TIER_LABELS[item.tier];
      list.append(row({
        title: qLabel(item.questionId),
        sub: [tier, item.reason].filter(Boolean).join(' ・ '),
        classes: ['row-indent'],
      }));
    }
  }

  /* 知らせ ------------------------------------------------------------ */

  for (const notice of plan.notices) {
    list.append(row({
      title: notice.humanInputRequired ? '相談したいこと' : 'お知らせ',
      sub: notice.message,
      classes: ['row-indent'],
    }));
  }

  if (validation.rejected.length) {
    list.append(row({
      title: '変えなかったもの',
      sub: [...new Set(validation.rejected.map((entry) => entry.message))].join(' / '),
      classes: ['row-indent'],
    }));
  }

  /* 実行 -------------------------------------------------------------- */

  const button = el('button', 'btn btn-primary', '今すぐ組み直す');
  button.disabled = !validation.ok;
  button.onclick = async () => {
    button.disabled = true;
    const result = await runAutoPlan({ force: true, horizonDays: meta.horizonDays ?? DEFAULT_HORIZON_DAYS });
    if (result.applied) {
      alert(`予定を組み直しました（追加${result.counts.added} / 取りやめ${result.counts.removed}`
        + ` / 繰り越し${result.counts.carriedOver}）。`);
    } else {
      alert('変えるところはありませんでした。');
    }
    await rerender();
  };
  const wrap = el('div', 'setting-actions');
  wrap.append(button);
  list.append(wrap);

  if (meta.lastRun) {
    list.append(row({
      title: '前回',
      sub: `${meta.lastRun.date} ・ 追加${meta.lastRun.added} / 取りやめ${meta.lastRun.removed}`
        + ` / 繰り越し${meta.lastRun.carriedOver}`,
      classes: ['row-indent'],
    }));
  }

  list.append(row({
    title: '変えないもの',
    sub: 'いま解いている問題・完了した予定・固定した予定・自分で入れた予定には手を触れません。'
      + ' 過ぎた日の予定も書き換えません。',
    classes: ['row-indent'],
  }));
}
