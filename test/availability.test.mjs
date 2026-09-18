// 学習に使える時間の決まり方。
//
// とくに「曜日をひとつだけ入れたら、全部の曜日に使う」を確かめる。
// 7つ全部を書かせるのは手間なだけなので、ふだんは1つでよい。

import { test } from "node:test";
import assert from "node:assert/strict";

import { availabilityForDate, singleWeeklyValue } from "../src/availability.js";

const weekly = (overrides = {}) => ({
  weekly: { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, ...overrides },
  overrides: {},
  todayRemaining: null,
  reserveMinutes: 0,
  timerIncludesReview: true,
  reviewOverheadSeconds: 0,
});

// 2026-09-14 は月曜。以降 15=火 16=水 17=木 18=金 19=土 20=日。
const MON = "2026-09-14";
const WED = "2026-09-16";
const SAT = "2026-09-19";

test("ひとつだけ入れたら、全部の曜日でその値を使う", () => {
  const settings = weekly({ mon: 60 });
  for (const date of [MON, WED, SAT]) {
    assert.equal(availabilityForDate(settings, date).available, 60, `${date} に使われていない`);
  }
});

test("全部に広げた日は、そうと分かるようにする", () => {
  const settings = weekly({ mon: 60 });
  const own = availabilityForDate(settings, MON);
  const spread = availabilityForDate(settings, WED);
  assert.equal(own.source, "weekly");
  assert.equal(spread.source, "weekly_single");
  assert.match(spread.note, /曜日をひとつだけ入れたので/);
});

test("ふたつ以上入れたら、書いたとおりに受け取る", () => {
  const settings = weekly({ mon: 60, wed: 90 });
  assert.equal(availabilityForDate(settings, MON).available, 60);
  assert.equal(availabilityForDate(settings, WED).available, 90);
  // 書かなかった曜日は未設定のまま。書き分けた意図を勝手に広げない。
  assert.equal(availabilityForDate(settings, SAT).available, null);
  assert.equal(availabilityForDate(settings, SAT).source, "not_configured");
});

test("勉強できない曜日は 0 と入れれば、その日だけ0分になる", () => {
  const settings = weekly({ mon: 60, sat: 0 });
  assert.equal(availabilityForDate(settings, MON).available, 60);
  assert.equal(availabilityForDate(settings, SAT).available, 0);
  assert.equal(availabilityForDate(settings, SAT).configured, true, "0分が未設定になっている");
});

test("ひとつも入れていなければ、未設定のまま", () => {
  const settings = weekly();
  assert.equal(availabilityForDate(settings, MON).available, null);
  assert.equal(availabilityForDate(settings, MON).source, "not_configured");
});

test("ひとつだけ 0 を入れた場合も、全部の曜日が0分になる", () => {
  // 「いまは勉強しない」をひとことで言えるようにする。
  const settings = weekly({ thu: 0 });
  assert.equal(availabilityForDate(settings, MON).available, 0);
  assert.equal(availabilityForDate(settings, MON).configured, true);
});

test("その日だけの上書きは、広げた値より強い", () => {
  const settings = weekly({ mon: 60 });
  settings.overrides = { [SAT]: 0 };
  assert.equal(availabilityForDate(settings, SAT).available, 0);
  assert.equal(availabilityForDate(settings, SAT).source, "override");
});

test("singleWeeklyValue は、ひとつのときだけ値を返す", () => {
  assert.equal(singleWeeklyValue({ mon: 60 }), 60);
  assert.equal(singleWeeklyValue({ mon: 0 }), 0);
  assert.equal(singleWeeklyValue({ mon: 60, tue: 60 }), null);
  assert.equal(singleWeeklyValue({}), null);
});
