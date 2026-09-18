// はじめて開いたときの使い方案内を、実際に触って通す。
//
// ここで確かめたいのは1つ。「案内が本物の画面を指していて、
// 指されたところを実際に押すと次へ進む」こと。
// 案内の中だけで完結する作りだと、このテストは通らない。

import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { loadPlaywright, startTestServer } from "./server.mjs";

const playwright = await loadPlaywright();
const options = playwright ? {} : { skip: "Playwright が無いので飛ばします" };

let server = null;
let browser = null;

before(async () => { if (playwright) browser = await playwright.chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { if (playwright) server = await startTestServer(); });
afterEach(async () => { await server?.close(); server = null; });

async function openApp() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${server.origin}/index.html`);
  await page.waitForFunction(() => document.querySelectorAll(".tabbar button").length > 0);
  await page.waitForFunction(async () => {
    const api = await import("./src/api.js");
    return (await api.listQuestions()).length > 0;
  }, null, { timeout: 20000 });
  return { page, context, errors };
}

const title = (page) => page.locator(".tour-title").innerText();
const waitForStep = (page, text) =>
  page.locator(".tour-title", { hasText: text }).waitFor({ timeout: 10000 });

test("はじめて開くと、使い方の案内が出る", options, async () => {
  const { page, context, errors } = await openApp();
  await page.locator(".tour-card").waitFor({ timeout: 10000 });
  assert.match(await title(page), /ようこそ/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("指されたところを実際に押すと、次へ進む", options, async () => {
  const { page, context, errors } = await openApp();
  await page.locator(".tour-card").waitFor({ timeout: 10000 });

  // 1. ようこそ → やってみる
  await page.locator(".tour-next").click();
  await waitForStep(page, "設定");

  // 2. 指しているのは、本物の「設定」タブである。
  // 穴は前の位置から滑って移動するので、収まるのを待ってから比べる。
  await page.waitForFunction(() => {
    const hole = document.querySelector(".tour-hole")?.getBoundingClientRect();
    const tab = document.querySelector('[data-tour="tab-settings"]')?.getBoundingClientRect();
    if (!hole || !tab) return false;
    // 穴は対象より少し大きい。中心が合っていればよい。
    return Math.abs((hole.left + hole.width / 2) - (tab.left + tab.width / 2)) < 3
      && Math.abs((hole.top + hole.height / 2) - (tab.top + tab.height / 2)) < 3;
  }, null, { timeout: 5000 });

  // 穴は対象より大きく開いている（ふちが隠れない）。
  const size = await page.evaluate(() => {
    const hole = document.querySelector(".tour-hole").getBoundingClientRect();
    const tab = document.querySelector('[data-tour="tab-settings"]').getBoundingClientRect();
    return { hole: hole.width, tab: tab.width };
  });
  assert.ok(size.hole > size.tab, `穴が対象より小さい: ${JSON.stringify(size)}`);

  // 案内は「次へ」を出していない＝実際に押すまで進まない。
  assert.equal(await page.locator(".tour-next").count(), 0, "押さなくても進めてしまう");

  // 3. 本物の設定タブを押す（案内の上からでも押せる）。
  await page.locator('[data-tour="tab-settings"]').click();
  await waitForStep(page, "目標");
  assert.equal(await page.locator("#screen-settings").isVisible(), true, "設定タブへ移っていない");

  // 4. 「目標」を開く
  await page.locator('[data-tour="section-goals"]').click();
  await waitForStep(page, "目標を追加");

  // 5. 「目標を追加」
  await page.locator('[data-tour="goal-add"]').click();
  await waitForStep(page, "この内容で作成");

  // 案内のカードが、これから押すものを隠していない。
  const overlap = await page.evaluate(() => {
    const card = document.querySelector(".tour-card").getBoundingClientRect();
    const submit = document.querySelector('[data-tour="goal-submit"]')?.getBoundingClientRect();
    if (!submit) return { hidden: false, reason: "no-submit" };
    const covered = submit.top < card.bottom && submit.bottom > card.top
      && submit.left < card.right && submit.right > card.left;
    return { hidden: covered };
  });
  assert.equal(overlap.hidden, false, "案内が「この内容で作成」を隠している");

  // 6. 中身を入れて作成する（実際に目標ができたときだけ進む）。
  await page.locator(".section-body input.cloud-input").first().fill("1章をひととおり");
  await page.locator('[data-tour="goal-submit"]').click();
  await waitForStep(page, "学習に使える時間");

  const goals = await page.evaluate(async () => (await (await import("./src/api.js")).getGoals()).length);
  assert.equal(goals, 1, "目標ができていないのに進んだ");

  // 7. 「学習に使える時間」を開く
  await page.locator('[data-tour="section-availability"]').click();
  await waitForStep(page, "曜日ごと");

  // 8. 分を入れる（入れたときだけ進む）。
  // 今日の曜日に入れる。別の曜日だけ入れても、今日の予定は空のままになる。
  // 曜日はアプリと同じ出し方（UTC基準）で求める。ブラウザの時間帯で
  // getDay() を使うと、1日ずれた曜日に入れてしまう。
  const todayIndex = await page.evaluate(async () => {
    const { weekdayKeyOf, WEEKDAY_KEYS } = await import("./src/availability.js");
    const api = await import("./src/api.js");
    return WEEKDAY_KEYS.indexOf(weekdayKeyOf(api.todayKey()));
  });
  const cell = page.locator('[data-tour="weekday-grid"] input').nth(todayIndex);
  await cell.fill("60");
  await cell.blur();
  await waitForStep(page, "ホーム");

  // 9. ホームへ戻る
  await page.locator('[data-tour="tab-home"]').click();
  await waitForStep(page, "今日やる問題");

  // 「ここに今日やる問題が並ぶ」と言う以上、本当に並んでいなければならない。
  await page.waitForFunction(
    () => document.querySelectorAll('[data-tour="home-todo"] .row').length > 0,
    null, { timeout: 10000 },
  );
  const todo = await page.evaluate(
    () => document.querySelectorAll('[data-tour="home-todo"] .row').length);
  assert.ok(todo > 0, "案内が約束した予定が、実際には並んでいない");

  // 10〜11. 説明を読み進める
  await page.locator(".tour-next").click();
  await waitForStep(page, "計測");
  await page.locator(".tour-next").click();
  await waitForStep(page, "準備はここまで");

  // 12. 終わる
  await page.locator(".tour-next").click();
  await page.locator(".tour-card").waitFor({ state: "detached", timeout: 5000 });

  assert.deepEqual(errors, []);
  await context.close();
});

test("一度見たら、開き直しても出てこない", options, async () => {
  const { page, context, errors } = await openApp();
  await page.locator(".tour-card").waitFor({ timeout: 10000 });
  await page.locator(".tour-skip").click();
  await page.locator(".tour-card").waitFor({ state: "detached", timeout: 5000 });

  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll(".tabbar button").length > 0);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator(".tour-card").count(), 0, "もう一度出てきてしまった");

  assert.deepEqual(errors, []);
  await context.close();
});

test("設定 → 使い方 から、もう一度呼べる", options, async () => {
  const { page, context, errors } = await openApp();
  await page.locator(".tour-card").waitFor({ timeout: 10000 });
  await page.locator(".tour-skip").click();
  await page.locator(".tour-card").waitFor({ state: "detached", timeout: 5000 });

  await page.locator('[data-tour="tab-settings"]').click();
  await page.locator(".section-toggle", { hasText: "使い方" }).click();
  await page.locator("button", { hasText: "使い方をもう一度見る" }).click();

  await page.locator(".tour-card").waitFor({ timeout: 10000 });
  assert.match(await title(page), /ようこそ/);
  // 案内はホームから始まるので、ホームへ戻っている。
  assert.equal(await page.locator("#screen-home").isVisible(), true, "ホームへ戻っていない");

  assert.deepEqual(errors, []);
  await context.close();
});

test("予定が空のときは、その理由を添える", options, async () => {
  const { page, context, errors } = await openApp();
  await page.locator(".tour-card").waitFor({ timeout: 10000 });
  await page.locator(".tour-skip").click();
  await page.locator(".tour-card").waitFor({ state: "detached" });

  // 目標はあるが、今日の曜日には時間を入れていない状態を作る。
  const note = await page.evaluate(async () => {
    const api = await import("./src/api.js");
    const runner = await import("./src/tour-runner.js");
    const questions = (await api.listQuestions()).slice(0, 10);
    await api.addGoal({ title: "目標", questionIds: questions.map((q) => q.id), priority: 1 });
    const { weekdayKeyOf, WEEKDAY_KEYS } = await import("./src/availability.js");
    const todayIndex = WEEKDAY_KEYS.indexOf(weekdayKeyOf(api.todayKey()));
    // わざと今日とは違う曜日にだけ入れる。
    await api.saveAvailability({ weekly: { [WEEKDAY_KEYS[(todayIndex + 3) % 7]]: 60 } });
    return runner.noteFor("todo");
  });

  assert.ok(note, "空なのに理由を出していない");
  assert.match(note, /いまは空です/);
  assert.match(note, /学習に使える時間/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("予定が並んでいるときは、よけいな一言を出さない", options, async () => {
  const { page, context, errors } = await openApp();
  await page.locator(".tour-card").waitFor({ timeout: 10000 });
  await page.locator(".tour-skip").click();
  await page.locator(".tour-card").waitFor({ state: "detached" });

  const note = await page.evaluate(async () => {
    const api = await import("./src/api.js");
    const runner = await import("./src/tour-runner.js");
    const { runAutoPlan } = await import("./src/auto-plan-runner.js");
    const questions = (await api.listQuestions()).slice(0, 10);
    await api.addGoal({ title: "目標", questionIds: questions.map((q) => q.id), priority: 1 });
    await api.saveAvailability({
      weekly: { sun: 60, mon: 60, tue: 60, wed: 60, thu: 60, fri: 60, sat: 60 },
    });
    await runAutoPlan();
    return runner.noteFor("todo");
  });

  assert.equal(note, null, "予定があるのに理由を出している");
  assert.deepEqual(errors, []);
  await context.close();
});
