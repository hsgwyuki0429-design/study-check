// 設定タブの「自動スケジュール」カード。
//
// 置くのは操作だけにしてある。予定の中身はスケジュールタブとホームで見えるので、
// ここに同じものを並べても、設定画面が長くなるだけである。
//
// 例外は「お知らせ」で、これは予定を見ても分からないことだけを出す
//（期限に間に合わない・チャレンジの頃合い）。出るものが無ければ何も出ない。

import { el, row } from './ui.js';
import { getAutoPlanMeta, saveAutoPlanMeta, previewAutoPlan, runAutoPlan } from './auto-plan-runner.js';

export async function renderAutoPlanCard(list, rerender) {
  const meta = await getAutoPlanMeta();

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

  /* 知らせ（出るものがあるときだけ） ---------------------------------- */

  const { plan } = await previewAutoPlan({ horizonDays: meta.horizonDays });
  for (const notice of plan.notices) {
    // 段階や進み具合の説明は出さない。予定を見れば分かることは、ここでは繰り返さない。
    if (notice.kind === 'priority_stage' || notice.kind === 'review_overflow') continue;
    list.append(row({
      title: notice.humanInputRequired ? '相談したいこと' : 'お知らせ',
      sub: notice.message,
      classes: ['row-indent'],
    }));
  }

  /* 実行 -------------------------------------------------------------- */

  const button = el('button', 'btn btn-primary', '今すぐ組み直す');
  button.onclick = async () => {
    button.disabled = true;
    const result = await runAutoPlan({ force: true, horizonDays: meta.horizonDays });
    alert(result.applied
      ? `予定を組み直しました（追加${result.counts.added} / 取りやめ${result.counts.removed}`
        + ` / 繰り越し${result.counts.carriedOver}）。`
      : '変えるところはありませんでした。');
    await rerender();
  };
  const wrap = el('div', 'setting-actions');
  wrap.append(button);
  list.append(wrap);
}
