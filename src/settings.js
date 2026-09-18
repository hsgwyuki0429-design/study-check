// 設定タブ。
//
// 項目が増えたので、ふだんは「大枠」だけを並べ、押したところだけ中身を開く。
// 開くのは一度に1つ。どこに何があるかが、開かなくても分かることを優先している。

import * as api from './api.js';
import { state, render } from './state.js';
import { el, row, fmtDate } from './ui.js';
import { renderAvailabilityCard, renderGoalCard } from './settings-plan.js';
import { renderAutoPlanCard } from './settings-auto-plan.js';
import { helpPanel } from './squares.js';
import { countDemoStudyData, removeDemoStudyData, loadQuestionMaster } from './seed.js';
import { openTour } from './tour-runner.js';

async function update(patch) {
  state.settings = await api.saveSettings({ ...state.settings, ...patch });
  applyTheme();
  render();
}

export function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function choiceRow(title, sub, options, current, onSelect, disabled = false) {
  const item = el('div', `setting${disabled ? ' disabled' : ''}`);
  const head = el('div', 'setting-head');
  head.append(el('div', 'row-title', title));
  if (sub) head.append(el('div', 'row-sub', sub));
  item.append(head);
  const choices = el('div', 'choices');
  for (const [value, label] of options) {
    const b = el('button', 'choice', label);
    b.setAttribute('aria-selected', String(value === current));
    b.disabled = disabled;
    b.onclick = () => onSelect(value);
    choices.append(b);
  }
  item.append(choices);
  return item;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 大枠の見出し。押すと中身が開く（開いていれば閉じる）。
 * 中身は open のときだけ組み立てるので、閉じているあいだは読み込みも起きない。
 */
async function section(screen, { id, title, sub, build }) {
  const open = state.settingsOpen === id;
  const toggle = el('button', 'section-toggle');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.dataset.tour = `section-${id}`;
  const main = el('div', 'row-main');
  main.append(el('div', 'row-title', title));
  if (sub) main.append(el('div', 'row-sub', sub));
  toggle.append(main, el('span', 'section-mark', open ? '⌄' : '›'));
  toggle.onclick = () => {
    state.settingsOpen = open ? null : id;
    render();
  };
  screen.append(toggle);
  if (!open) return;
  const body = el('div', 'section-body');
  await build(body);
  screen.append(body);
}

/* ------------------------------------------------------------------ */
/* それぞれの中身                                                      */
/* ------------------------------------------------------------------ */

async function buildQuestions(list) {
  const info = await api.getAppInfo();
  list.append(row({
    title: '問題マスタ',
    sub: `${info.questionCount}問 ・ ${info.books.join('、') || '冊の情報なし'}`,
  }));
  if (info.courses?.length) {
    list.append(row({ title: 'SELECT STUDY', sub: info.courses.join(' ・ '), classes: ['row-indent'] }));
  }
  if (info.questionTypes.length) {
    list.append(row({
      title: '種類ごとの問題数',
      sub: info.questionTypes.map((t) => `${t.type} ${t.count}問`).join(' ・ '),
      classes: ['row-indent'],
    }));
  }

  const importBtn = el('button', 'btn', '問題をインポート');
  importBtn.onclick = () => document.querySelector('#dialog-import').showModal();
  const reloadBtn = el('button', 'btn', '同梱の問題マスタを読み直す');
  reloadBtn.onclick = async () => {
    if (!confirm('data/questions.json の内容で問題マスタを置き換えます。学習記録・予定・目標は消えません。')) return;
    try {
      const master = await loadQuestionMaster();
      const n = await api.importQuestions(master.questions, {
        replace: true,
        masterVersion: Number(master.masterVersion) || 0,
      });
      alert(`${n}問を読み込みました`);
      render();
    } catch (err) {
      alert(`読み込めませんでした: ${err.message}`);
    }
  };
  const importWrap = el('div', 'setting-actions');
  importWrap.append(importBtn, reloadBtn);
  list.append(importWrap);

  // 章と単元の一覧は、いちばん下にたたんで置く（数が多いため）。
  const outline = el('details', 'outline');
  outline.append(el('summary', null, '章と単元の一覧'));
  for (const subject of info.subjects) {
    outline.append(el('div', 'section-head', subject.subject));
    for (const ch of subject.chapters) {
      const total = ch.sectionDetails.reduce((sum, sd) => sum + sd.questionCount, 0);
      outline.append(row({ title: ch.chapter, sub: `${total}問` }));
      for (const sd of ch.sectionDetails) {
        outline.append(row({
          title: sd.section,
          sub: `${sd.questionCount}問${sd.page ? ` ・ p.${sd.page}〜` : ''}`,
          classes: ['row-indent'],
        }));
      }
    }
  }
  list.append(outline);

  // 以前の版が入れていた確認用のサンプル。本物の成績ではないので、明示的に消せるようにする。
  const demo = await countDemoStudyData();
  if (demo.records + demo.tasks + demo.goals + demo.questions > 0) {
    list.append(el('div', 'section-head', 'サンプル（デモ）データ'));
    list.append(row({
      title: '動作確認用のデータが残っています',
      sub: `学習記録${demo.records}件 ・ 予定${demo.tasks}件 ・ 目標${demo.goals}件 ・ 問題${demo.questions}問。これは実際の学習の記録ではありません。`,
    }));
    const purgeBtn = el('button', 'btn btn-danger', 'サンプルデータを削除');
    purgeBtn.onclick = async () => {
      if (!confirm('サンプルの学習記録・予定・目標・問題だけを削除します。本物の記録は残ります。よろしいですか？')) return;
      const removed = await removeDemoStudyData();
      alert(`削除しました（記録${removed.records} / 予定${removed.tasks} / 目標${removed.goals} / 問題${removed.questions}）`);
      render();
    };
    const purgeWrap = el('div', 'setting-actions');
    purgeWrap.append(purgeBtn);
    list.append(purgeWrap);
  }
}

async function buildBackup(list) {
  const info = await api.getAppInfo();
  const exportBtn = el('button', 'btn', 'JSONで書き出す');
  exportBtn.onclick = async () => {
    const data = await api.exportAll();
    download(`aochart-${api.todayKey()}.json`, JSON.stringify(data, null, 2));
  };
  const exportWrap = el('div', 'setting-actions');
  exportWrap.append(exportBtn);
  list.append(exportWrap);
  list.append(row({
    title: '書き出される内容',
    sub: '問題マスタ・学習記録・予定・チャレンジ結果・目標・繰り越しの記録・学習可能時間・見積もりの指定。'
      + '鍵（管理キー・端末キー・接続トークン）は入りません。',
    classes: ['row-indent'],
  }));
  list.append(row({
    title: 'データ形式のバージョン',
    sub: '書き出すデータの形の版',
    right: el('span', 'row-time', info.dataVersion),
  }));
}

/**
 * 学習データをすべて消す。戻せないので、二段階で確かめる。
 *
 * 消すのは学習記録・チャレンジ・予定・目標・繰り越しで、問題マスタは残す。
 */
async function buildDangerZone(list) {
  const [info, records, challenges] = await Promise.all([
    api.getAppInfo(),
    api.listRecords(),
    api.getChallengeResults(1000),
  ]);

  list.append(row({
    title: 'いま入っているもの',
    sub: `学習記録 ${records.length}件 ・ チャレンジ ${challenges.length}回 ・ 問題 ${info.questionCount}問`,
  }));
  list.append(row({
    title: '消えるもの',
    sub: '学習記録・チャレンジ結果・予定・目標・繰り越しの記録・学習可能時間・見積もりの指定。'
      + ' 問題マスタは残ります。',
    classes: ['row-indent'],
  }));
  list.append(row({
    title: '先に書き出しておけます',
    sub: '設定 → バックアップ → JSONで書き出す',
    classes: ['row-indent'],
  }));

  const button = el('button', 'btn btn-danger', '学習データをすべて削除');
  button.onclick = async () => {
    if (!confirm('学習記録・チャレンジ・予定・目標をすべて削除します。元に戻せません。続けますか？')) return;
    const answer = prompt('本当に削除するなら「削除」と入力してください。');
    if (answer !== '削除') {
      alert('削除しませんでした。');
      return;
    }
    const removed = await api.purgeStudyData();
    alert(`削除しました（記録${removed.records} / チャレンジ${removed.challenges} / 予定${removed.tasks}`
      + ` / 目標${removed.goals}）。`);
    location.reload();
  };
  const wrap = el('div', 'setting-actions');
  wrap.append(button);
  list.append(wrap);
}

/**
 * 使い方。
 *
 * はじめの案内は短くしてある（手を動かしてもらうためのもの）。
 * くわしい説明はここに置き、必要になったときに読めるようにする。
 */
const USAGE_TOPICS = [
  {
    title: '今日やる問題は、どう決まるのか',
    body: 'まず、前に間違えた問題の復習を置きます。そのあと、まだ解いていない問題を、'
      + '教科書に載っている順に置きます。使える時間に収まるところまでで止めます。'
      + ' 復習が多い日は、新しい問題が0問になることもあります。',
  },
  {
    title: '5つの評価の意味',
    body: '◯完璧にできた ／ 解もっと良い解法があった ／ 記記述が甘い ／ △計算ミス ／ ✕方針が違った。'
      + ' ✕がいちばん重く、次の学習日にすぐ復習に出ます。'
      + ' △と記は3日後、同じ失敗が続くと 2日後 → 次の学習日 と間隔が縮みます。'
      + ' 解はいちばん軽く、急ぎません。',
  },
  {
    title: 'いつ「できた」ことになるのか',
    body: '◯を2回そろえると「一応クリア」になり、しばらく出てこなくなります。'
      + ' そのあとで間違えると、クリアは取り消されて、また◯2回からやり直しです。',
  },
  {
    title: '目標の優先順位',
    body: '数が小さいほど先に進めます。優先順位2の問題が残っているうちは、'
      + '優先順位3の「新しい問題」には進みません。'
      + ' ただし復習は別で、どの優先順位のものでも、時期が来れば出ます。',
  },
  {
    title: '学習に使える時間',
    body: '曜日をひとつだけ入れると、その値を全部の曜日で使います。'
      + ' 勉強できない曜日があれば、その曜日に 0 と入れてください。'
      + ' 空欄のままだと「未設定」で、その日には予定を置きません。',
  },
  {
    title: 'やらなかった日はどうなるか',
    body: '失敗としては扱いません。やらなかった分は、そのまま次の日へ繰り越します。'
      + ' 理由を聞いたり、勝手に推測したりもしません。',
  },
  {
    title: '予定を動かされたくないとき',
    body: 'ホームの「やること」で、タスクを固定できます。'
      + ' 固定したものは、自動で消えたり動いたりしません。',
  },
  {
    title: 'データはどこにあるか',
    body: 'この端末のブラウザの中だけです。どこにも送っていません。'
      + ' ブラウザのデータを消すと学習記録も消えるので、大事なら 設定 → バックアップ で'
      + '書き出しておいてください。',
  },
];

async function buildUsage(list) {
  const tour = await api.getTourState();

  const start = el('button', 'btn btn-primary', 'はじめの案内をもう一度見る');
  start.onclick = () => {
    // 案内はホームから始まるので、そこへ戻してから出す。
    state.tab = 'home';
    state.settingsOpen = null;
    render();
    openTour({ onFinish: () => render() });
  };
  const wrap = el('div', 'setting-actions');
  wrap.append(start);
  list.append(wrap);
  list.append(row({
    title: '本物の画面で案内します',
    sub: '指したところを実際に押すと、次へ進みます。'
      + (tour.finishedAt ? ` 前に見たのは ${fmtDate(tour.finishedAt.slice(0, 10))} です。` : ''),
    classes: ['row-indent'],
  }));

  list.append(el('div', 'section-head', 'くわしい説明'));
  for (const topic of USAGE_TOPICS) {
    list.append(row({ title: topic.title, sub: topic.body, classes: ['row-indent'] }));
  }
}

/* ------------------------------------------------------------------ */

export async function renderSettings(screen) {
  screen.innerHTML = '';
  const head = el('div', 'view-head');
  head.append(el('div', 'view-title', '設定'));
  screen.append(head);

  const goals = await api.getGoals();
  const availability = await api.getAvailability();
  const configuredDays = Object.values(availability.weekly).filter((value) => value !== null).length;
  const availabilitySub = configuredDays === 0 ? '未設定（設定すると計画に使われます）'
    : configuredDays === 1 ? '毎日ぶんを設定済み（曜日ごとに変えることもできます）'
      : `${configuredDays}曜日ぶんを設定済み`;

  await section(screen, {
    id: 'goals',
    title: '目標',
    sub: goals.length ? `${goals.length}件（${goals.filter((g) => g.status === 'active').length}件が進行中）` : 'まだありません',
    build: (list) => renderGoalCard(list, render),
  });

  await section(screen, {
    id: 'availability',
    title: '学習に使える時間',
    sub: availabilitySub,
    build: (list) => renderAvailabilityCard(list, render),
  });

  await section(screen, {
    id: 'autoplan',
    title: '自動スケジュール',
    sub: '学習履歴から、その日にやる問題を自動で決める',
    build: (list) => renderAutoPlanCard(list, render),
  });

  await section(screen, {
    id: 'display',
    title: '表示',
    sub: `ダークモード: ${{ auto: '自動', light: 'ライト', dark: 'ダーク' }[state.settings.theme]}`,
    build: (list) => {
      list.append(choiceRow('ダークモード', null,
        [['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']],
        state.settings.theme,
        (v) => update({ theme: v })));
    },
  });

  await section(screen, {
    id: 'questions',
    title: '問題データ',
    sub: '問題マスタの確認・インポート・読み直し',
    build: buildQuestions,
  });

  await section(screen, {
    id: 'backup',
    title: 'バックアップ',
    sub: 'JSONで書き出す',
    build: buildBackup,
  });

  await section(screen, {
    id: 'danger',
    title: 'データの削除',
    sub: '学習データをすべて消す（元に戻せません）',
    build: buildDangerZone,
  });

  await section(screen, {
    id: 'usage',
    title: '使い方',
    sub: 'はじめの案内と、くわしい説明',
    build: buildUsage,
  });

  await section(screen, {
    id: 'help',
    title: 'ヘルプ（マスの見方）',
    sub: 'スケジュールと記録に出る、正方形の色の意味',
    build: (list) => { list.append(helpPanel()); },
  });
}
