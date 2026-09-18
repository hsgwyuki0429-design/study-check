// はじめて開いたときの使い方案内。
//
// 別の説明画面は作らない。本物の画面の上に穴を開けて、「まずここを押す」と
// 指してから、実際に押したときだけ次へ進む。読むだけの説明より、
// 一度自分でやったことのほうが覚えているためである。
//
// 決めごと:
//
//   ・案内は本物の画面の上に置く。作り物の画面を見せない
//   ・穴の部分は素通しにする（pointer-events: none）。本当にその場所を押せる
//   ・次へ進むのは「利用者が実際にやったとき」。こちらで画面を動かさない
//   ・いつでもやめられる。やめても、もう一度 設定 → 使い方 から呼べる
//   ・画面は操作のたび丸ごと組み直されるので、案内の位置は毎フレーム測り直す

import { el } from './ui.js';

/** 案内をもう出さない、を覚えておく場所。 */
export const TOUR_KEY = 'tour';

/** 案内の手順。上から順に進む。 */
export const STEPS = Object.freeze([
  {
    id: 'welcome',
    title: 'Study Check へようこそ',
    body: '青チャートの学習を記録して、その日にやる問題を自動で決めるアプリです。'
      + '最初に「目標」と「学習に使える時間」を決めると、あとは開くだけで今日の分が並びます。'
      + '\n\n実際に画面を触りながら、ひととおり設定してみましょう。',
    next: 'やってみる',
  },
  {
    id: 'open-settings',
    title: 'まず「設定」を押す',
    body: '目標と時間は、設定タブで決めます。',
    target: '[data-tour="tab-settings"]',
    await: 'click',
  },
  {
    id: 'open-goals',
    title: '「目標」を押して開く',
    body: '何を・いつまでに・どこまでやるかを決めます。',
    target: '[data-tour="section-goals"]',
    await: 'click',
  },
  {
    id: 'add-goal',
    title: '「目標を追加」を押す',
    body: 'まだ目標がないので、ひとつ作ってみましょう。',
    target: '[data-tour="goal-add"]',
    await: 'click',
  },
  {
    id: 'fill-goal',
    title: '中身を決めて、いちばん下の「この内容で作成」',
    body: '目標の名前と、対象にする範囲（章や単元）を選びます。範囲を選ばなければ、全部が対象になります。'
      + '\n\n優先順位は「どれから進めるか」の順番です。数が小さいほど先に進めます。',
    target: '[data-tour="goal-form"]',
    await: 'state',
    hint: '作成すると次へ進みます',
  },
  {
    id: 'open-availability',
    title: '次は「学習に使える時間」',
    body: '1日に何分使えるかが分からないと、どれだけ出してよいか決められません。',
    target: '[data-tour="section-availability"]',
    await: 'click',
  },
  {
    id: 'set-minutes',
    title: '曜日ごとに、使える分を入れる',
    body: 'ひとつでも入れれば先へ進めます。空欄は「未設定」で、0分とは違う扱いです。'
      + '\n\n未設定の日には、予定を置きません。',
    target: '[data-tour="weekday-grid"]',
    await: 'state',
    hint: '入れると次へ進みます',
  },
  {
    id: 'back-home',
    title: '「ホーム」に戻る',
    body: 'これで材料がそろいました。今日の分がどうなったか見てみましょう。',
    target: '[data-tour="tab-home"]',
    await: 'click',
  },
  {
    id: 'todo',
    title: 'ここに今日やる問題が並ぶ',
    body: '弱点の復習を先に、そのあと新しい問題を、使える時間に収まるだけ置いています。'
      + '\n\n開くたびに組み直すので、毎日「何をやるか」を自分で考えなくてすみます。',
    target: '[data-tour="home-todo"]',
    next: '次へ',
  },
  {
    id: 'start',
    title: '問題を押すと計測が始まる',
    body: '解き終わったら、5つのボタンからその日の出来を選びます。'
      + '\n\n◯完璧にできた／解もっと良い解法／記記述が甘い／△計算ミス／✕方針が違った。'
      + '\n\nこの評価をもとに、次にいつ復習するかが決まります。',
    target: '[data-tour="home-todo"]',
    next: '次へ',
  },
  {
    id: 'done',
    title: '準備はここまで',
    body: 'あとは、勉強のときにこのアプリを開くだけです。'
      + '\n\nもう一度この案内を見たいときは、設定 → 使い方 から呼べます。',
    next: 'はじめる',
  },
]);

/* ------------------------------------------------------------------ */

let active = null;

export const isRunning = () => active !== null;

/**
 * 案内を始める。
 *
 *   onFinish … 最後まで行った / やめたときに呼ばれる
 *   isDone   … 手順ごとの「もう終わったか」を調べる関数（await: 'state' の手順で使う）
 */
export function startTour({
  onFinish = () => {},
  isDone = async () => false,
  onStepDone = () => {},
  note = async () => null,
} = {}) {
  if (active) return active;

  const root = el('div', 'tour');
  const hole = el('div', 'tour-hole');
  const card = el('div', 'tour-card');
  root.append(hole, card);
  document.body.append(root);

  const state = {
    index: 0,
    root,
    hole,
    card,
    onFinish,
    isDone,
    onStepDone,
    note,
    rect: null,
    frame: 0,
    checking: false,
    lastCheck: 0,
    lastScroll: 0,
  };
  active = state;

  document.addEventListener('click', onDocumentClick, true);
  window.addEventListener('resize', measure);
  showStep();
  state.frame = requestAnimationFrame(tick);
  return state;
}

export function stopTour({ finished = false } = {}) {
  if (!active) return;
  const { root, onFinish, frame } = active;
  cancelAnimationFrame(frame);
  document.removeEventListener('click', onDocumentClick, true);
  window.removeEventListener('resize', measure);
  root.remove();
  active = null;
  onFinish({ finished });
}

const currentStep = () => (active ? STEPS[active.index] : null);

function advance() {
  if (!active) return;
  const finished = currentStep();
  if (active.index >= STEPS.length - 1) {
    stopTour({ finished: true });
    return;
  }
  active.index += 1;
  showStep();
  // 終えた手順を知らせる。案内の先で見せるものを、ここで用意してもらう。
  try {
    active.onStepDone(finished.id);
  } catch (error) {
    console.warn('使い方案内の後処理に失敗しました:', error.message);
  }
}

/** いま指している本物の要素。まだ画面に無いこともある。 */
function targetNode() {
  const step = currentStep();
  if (!step?.target) return null;
  return document.querySelector(step.target);
}

function showStep() {
  const step = currentStep();
  if (!step) return;
  active.rect = null;
  buildCard(step);
  // カードの高さが決まってから測り、そのうえで隠れない位置まで運ぶ。
  measure();
  ensureVisible();
}

function buildCard(step) {
  const { card } = active;
  card.innerHTML = '';

  const count = el('div', 'tour-count', `${active.index + 1} / ${STEPS.length}`);
  const title = el('div', 'tour-title', step.title);
  const body = el('div', 'tour-body');
  // 段落の切れ目を、そのまま行の切れ目として出す。
  for (const paragraph of step.body.split('\n\n')) {
    body.append(el('p', null, paragraph));
  }
  card.append(count, title, body);

  // 実際のデータを見たうえで足す一言。あとから届くので、置き場所だけ先に作る。
  const note = el('div', 'tour-note');
  note.hidden = true;
  card.append(note);
  Promise.resolve(active.note(step.id))
    .then((text) => {
      if (!active || currentStep()?.id !== step.id || !text) return;
      note.textContent = text;
      note.hidden = false;
      measure();
    })
    .catch(() => {});

  if (step.await) {
    card.append(el('div', 'tour-wait', step.hint ?? 'ここを押すと次へ進みます'));
  }

  const actions = el('div', 'tour-actions');
  const skip = el('button', 'tour-skip', step.id === 'done' ? '閉じる' : 'あとで');
  skip.onclick = () => stopTour({ finished: step.id === 'done' });
  actions.append(skip);

  if (step.next) {
    const next = el('button', 'tour-next', step.next);
    next.onclick = advance;
    actions.append(next);
  }
  card.append(actions);
}

/**
 * 穴とカードの位置を、本物の要素に合わせる。
 *
 * 置き方の決まりは1つだけにしてある。
 *
 *   ・カードは画面の下に置く
 *   ・ただし指す先そのものが下にある（タブバーなど）ときは、その上に置く
 *
 * こうすると「カードが、押してほしいものを隠す」ことが起きない。
 * 隠れてしまうと、指示は読めるのに押せない、といういちばん困る状態になる。
 */

/** 画面の下のほう。ここにあるものは、カードで隠さないよう上に置く。 */
const BOTTOM_ZONE = 180;

function measure() {
  if (!active) return;
  const node = targetNode();
  const { hole, card, root } = active;

  if (!node) {
    // 指す先がまだ無い。穴は閉じて、カードだけ真ん中に出す。
    hole.style.opacity = '0';
    hole.style.width = '0';
    hole.style.height = '0';
    root.dataset.placement = 'center';
    card.style.top = '';
    card.style.bottom = '';
    active.rect = null;
    return;
  }

  const rect = node.getBoundingClientRect();
  const previous = active.rect;
  if (previous && previous.top === rect.top && previous.left === rect.left
    && previous.width === rect.width && previous.height === rect.height) return;
  active.rect = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };

  const pad = 6;
  hole.style.opacity = '1';
  hole.style.top = `${rect.top - pad}px`;
  hole.style.left = `${rect.left - pad}px`;
  hole.style.width = `${rect.width + pad * 2}px`;
  hole.style.height = `${rect.height + pad * 2}px`;

  if (rect.top > window.innerHeight - BOTTOM_ZONE) {
    // 指す先が下にある。その上へ置く。
    root.dataset.placement = 'above';
    card.style.top = '';
    card.style.bottom = `${window.innerHeight - rect.top + pad + 12}px`;
  } else {
    root.dataset.placement = 'bottom';
    card.style.top = '';
    card.style.bottom = '16px';
  }
}

/** カードに隠れない範囲（上端・下端）。 */
function freeBand() {
  const cardRect = active.card.getBoundingClientRect();
  return { top: 12, bottom: cardRect.top - 12 };
}

/** その要素を実際にスクロールさせている親を探す。 */
function scrollableAncestor(node) {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
  }
  return null;
}

/**
 * 指す先を、カードに隠れないところまで運ぶ。
 * 対象がカードより高いときは、上端をそろえる（頭から読めるようにする）。
 */
function ensureVisible() {
  if (!active) return;
  const node = targetNode();
  if (!node) return;
  if (active.root.dataset.placement === 'above') return;  // 下にあるものは動かさない
  const scroller = scrollableAncestor(node);
  if (!scroller) return;

  const band = freeBand();
  const rect = node.getBoundingClientRect();
  if (rect.top >= band.top && rect.bottom <= band.bottom) return;  // もう見えている

  const height = band.bottom - band.top;
  const delta = rect.height > height
    ? rect.top - band.top
    : (rect.top + rect.height / 2) - (band.top + height / 2);
  scroller.scrollBy({ top: delta, behavior: 'smooth' });
}

/** 画面は操作のたび組み直されるので、位置は毎フレーム見張る。 */
function tick() {
  if (!active) return;
  measure();
  keepInView();
  checkState();
  active.frame = requestAnimationFrame(tick);
}

/**
 * 指す先が画面から完全に出てしまったときだけ、運び直す。
 * 少しはみ出しただけで追いかけると、利用者のスクロールと取り合ってしまう。
 */
function keepInView() {
  const rect = active.rect;
  if (!rect) return;
  const now = Date.now();
  if (now - active.lastScroll < 600) return;
  const offScreen = rect.top > window.innerHeight || rect.top + rect.height < 0;
  if (!offScreen) return;
  active.lastScroll = now;
  ensureVisible();
}

/** 「作成できたか」「入力できたか」を、ときどき確かめる。 */
function checkState() {
  const step = currentStep();
  if (!active || step?.await !== 'state' || active.checking) return;
  const now = Date.now();
  if (now - active.lastCheck < 400) return;
  active.lastCheck = now;
  active.checking = true;
  Promise.resolve(active.isDone(step.id))
    .then((done) => {
      if (done && active && currentStep()?.id === step.id) advance();
    })
    .catch(() => {})
    .finally(() => { if (active) active.checking = false; });
}

/** 指した場所を実際に押したら、次へ進む。 */
function onDocumentClick(event) {
  const step = currentStep();
  if (!active || step?.await !== 'click' || !step.target) return;
  if (!event.target.closest?.(step.target)) return;
  // アプリ側がこの操作で画面を組み直すので、そのあとで進める。
  setTimeout(() => {
    if (active && currentStep()?.id === step.id) advance();
  }, 0);
}
