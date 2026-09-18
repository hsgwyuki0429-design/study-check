// 実ブラウザでの通し確認。
//
// Node のテストは「判定のしかた」を確かめるもので、
// タップ → IndexedDB → Service Worker → 再起動 → オフライン までは通っていない。
// ここはその1本を、本物のブラウザで通す。
//
//   npm run test:e2e
//
// Playwright が無い環境では、何も落とさずに飛ばす。

import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { loadPlaywright, startTestServer } from "./server.mjs";

const playwright = await loadPlaywright();
const options = playwright ? {} : { skip: "Playwright が無いので飛ばします" };

let server = null;
let browser = null;

before(async () => {
  if (!playwright) return;
  browser = await playwright.chromium.launch();
});

after(async () => {
  await browser?.close();
});

beforeEach(async () => {
  if (!playwright) return;
  server = await startTestServer();
});

afterEach(async () => {
  await server?.close();
  server = null;
});

/** アプリを1つ開く。ブラウザのプロファイルが分かれる＝別の端末。 */
async function openApp() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${server.origin}/index.html`);
  await page.waitForFunction(() => document.querySelectorAll(".tabbar button").length > 0);
  // 問題マスタの投入が終わるまで待つ。
  await page.waitForFunction(async () => {
    const api = await import("./src/api.js");
    return (await api.listQuestions()).length > 0;
  });
  return { page, context, errors };
}

const counts = (page) => page.evaluate(async () => {
  const api = await import("./src/api.js");
  return {
    records: (await api.listRecords()).length,
    questions: (await api.listQuestions()).length,
  };
});

test("記録をつけて、閉じて開いても残っている", options, async () => {
  const { page, context, errors } = await openApp();
  const before = await counts(page);
  assert.ok(before.questions > 0, "問題マスタが入っていない");
  assert.equal(before.records, 0);

  await page.evaluate(async () => {
    const api = await import("./src/api.js");
    const [question] = await api.listQuestions();
    await api.addStudyRecord({ questionId: question.id, evaluation: "perfect", durationSeconds: 180 });
  });

  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll(".tabbar button").length > 0);
  assert.equal((await counts(page)).records, 1, "再起動で記録が消えた");
  assert.deepEqual(errors, []);
  await context.close();
});

test("オフラインでも起動でき、記録をつけられる", options, async () => {
  const { page, context, errors } = await openApp();
  // Service Worker がアプリシェルを取り込むまで待つ。
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => (await caches.keys()).length > 0);

  server.goOffline();
  try {
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".tabbar button").length > 0, null, { timeout: 15000 });
    // 画面が組み上がる＝ src/*.js がキャッシュから全部取れている。
    for (const tab of ["記録", "スケジュール", "設定"]) {
      await page.locator(".tabbar button", { hasText: tab }).click();
      await page.waitForTimeout(400);
    }
    await page.evaluate(async () => {
      const api = await import("./src/api.js");
      const [question] = await api.listQuestions();
      await api.addStudyRecord({ questionId: question.id, evaluation: "calc_error", durationSeconds: 120 });
    });
    assert.equal((await counts(page)).records, 1, "オフラインで記録できなかった");
  } finally {
    server.goOnline();
  }
  assert.deepEqual(errors.filter((text) => !/Failed to fetch|net::ERR|504/.test(text)), []);
  await context.close();
});

test("目標と使える時間を決めると、自動スケジュールが今日の予定を作る", options, async () => {
  const { page, context, errors } = await openApp();

  const result = await page.evaluate(async () => {
    const api = await import("./src/api.js");
    const runner = await import("./src/auto-plan-runner.js");

    // 掲載順の先頭から10問を目標にする。
    const questions = (await api.listQuestions()).slice(0, 10);
    await api.addGoal({ title: "E2Eの目標", questionIds: questions.map((question) => question.id), priority: 1 });
    await api.saveAvailability({
      weekly: { sun: 60, mon: 60, tue: 60, wed: 60, thu: 60, fri: 60, sat: 60 },
    });

    const first = await runner.runAutoPlan();
    const tasks = await api.getTodayTasks();
    // 同じ状態でもう一度走らせても、予定は増えない（企画書17章）。
    // 当てたあとは差分そのものが無くなる（no_change）。差分が残る場合でも、
    // 同じ operationId なので当てない（already_applied）。
    const second = await runner.runAutoPlan();
    return {
      applied: first.applied,
      added: first.counts?.added ?? 0,
      taskCount: tasks.length,
      questionIds: tasks.flatMap((task) => task.questionIds),
      allAuto: tasks.every((task) => task.source === "auto"),
      secondApplied: second.applied,
      secondReason: second.reason,
      taskCountAfter: (await api.getTodayTasks()).length,
    };
  });

  assert.equal(result.applied, true, "自動スケジュールが予定を作らなかった");
  assert.ok(result.taskCount > 0, "今日の予定が空のまま");
  assert.equal(result.allAuto, true, "自動で置いた印が付いていない");
  // 掲載順に並んでいる（企画書9章）。
  assert.deepEqual(result.questionIds, [...result.questionIds].sort());

  assert.equal(result.secondApplied, false, "同じ案が二度当たった");
  assert.ok(["no_change", "already_applied"].includes(result.secondReason), result.secondReason);
  assert.equal(result.taskCountAfter, result.taskCount, "二度目で予定が増えた");

  assert.deepEqual(errors, []);
  await context.close();
});

test("固定した予定は、自動スケジュールでも動かない", options, async () => {
  const { page, context, errors } = await openApp();

  const result = await page.evaluate(async () => {
    const api = await import("./src/api.js");
    const runner = await import("./src/auto-plan-runner.js");

    const questions = await api.listQuestions();
    // 掲載順ではずっと後ろの問題を、自分で今日の予定に入れて固定する。
    const mine = questions[questions.length - 1];
    await api.updateTodayTasks(
      [{ id: "task-mine", kind: "new", questionIds: [mine.id], order: 0, pinned: true }],
      api.todayKey(),
    );
    await api.addGoal({
      title: "E2Eの目標",
      questionIds: questions.slice(0, 10).map((question) => question.id),
      priority: 1,
    });
    await api.saveAvailability({
      weekly: { sun: 60, mon: 60, tue: 60, wed: 60, thu: 60, fri: 60, sat: 60 },
    });

    await runner.runAutoPlan();
    const tasks = await api.getTodayTasks();
    return {
      keptMine: tasks.some((task) => task.id === "task-mine" && task.questionIds[0] === mine.id),
      total: tasks.length,
    };
  });

  assert.equal(result.keptMine, true, "固定した予定が消された");
  assert.ok(result.total > 1, "固定した予定のほかに何も置かれていない");
  assert.deepEqual(errors, []);
  await context.close();
});

test("設定タブの「自動スケジュール」を開くと、今日の案と理由が出る", options, async () => {
  const { page, context, errors } = await openApp();

  await page.evaluate(async () => {
    const api = await import("./src/api.js");
    const questions = (await api.listQuestions()).slice(0, 10);
    await api.addGoal({ title: "E2Eの目標", questionIds: questions.map((question) => question.id), priority: 1 });
    await api.saveAvailability({
      weekly: { sun: 60, mon: 60, tue: 60, wed: 60, thu: 60, fri: 60, sat: 60 },
    });
  });

  await page.locator(".tabbar button", { hasText: "設定" }).click();
  await page.locator(".section-toggle", { hasText: "自動スケジュール" }).click();
  await page.locator(".section-body").waitFor();

  const body = page.locator(".section-body");
  await body.locator("text=今日の理由").waitFor({ timeout: 10000 });
  await body.locator("text=習得フェーズ").waitFor();
  // 押す前に「こうなります」が見えている（企画書17章）。
  await body.locator("button", { hasText: "今すぐ組み直す" }).waitFor();

  assert.deepEqual(errors, []);
  await context.close();
});

test("GitHub Pages のように階層の途中へ置いても、そのまま動く", options, async () => {
  // プロジェクトページは https://<名前>.github.io/study-check/ に置かれる。
  // 根元を前提にした絶対パスが1つでもあると、ここで落ちる。
  await server.close();
  server = await startTestServer({ basePath: "study-check" });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await page.goto(server.appUrl);
  await page.waitForFunction(() => document.querySelectorAll(".tabbar button").length > 0);
  // 問題マスタ（data/questions.json）も、この階層から読めている。
  await page.waitForFunction(async () => {
    const api = await import("./src/api.js");
    return (await api.listQuestions()).length > 0;
  }, null, { timeout: 15000 });

  // Service Worker の担当範囲が、アプリの置かれた階層になっている。
  await page.evaluate(() => navigator.serviceWorker.ready);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  assert.match(scope, /\/study-check\/$/, `Service Worker の scope が階層に合っていない: ${scope}`);

  // 全タブが組み上がる。
  for (const tab of ["記録", "スケジュール", "設定"]) {
    await page.locator(".tabbar button", { hasText: tab }).click();
    await page.waitForTimeout(300);
  }

  // この階層のまま、オフラインでも起動できる。
  await page.waitForFunction(async () => (await caches.keys()).length > 0);
  server.goOffline();
  try {
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".tabbar button").length > 0, null, { timeout: 15000 });
  } finally {
    server.goOnline();
  }

  assert.deepEqual(errors.filter((text) => !/Failed to fetch|net::ERR|504/.test(text)), []);
  await context.close();
});
