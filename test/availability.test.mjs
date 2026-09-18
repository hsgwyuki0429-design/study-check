// 学習に使える時間の決まり方。
//
// 決めてもらうのは「平日」と「休日」の2つだけ。7つ全部を書かせない。
// 片方だけ書いたときは、もう片方にもその値を使う。
// 勉強しない日は 0 と書けばよい。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  availabilityForDate, fallbackWeeklyValue, groupValue, WEEKDAY_GROUPS,
} from "../src/availability.js";

const weekly = (overrides = {}) => ({
  weekly: { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, ...overrides },
});

/** 画面の「平日」「休日」と同じ書き方をする。 */
const byGroup = ({ weekday = null, holiday = null } = {}) => {
  const value = {};
  for (const day of WEEKDAY_GROUPS[0].days) value[day] = weekday;
  for (const day of WEEKDAY_GROUPS[1].days) value[day] = holiday;
  return weekly(value);
};

// 2026-09-14 は月曜。以降 15=火 16=水 17=木 18=金 19=土 20=日。
const MON = "2026-09-14";
const WED = "2026-09-16";
const SAT = "2026-09-19";
const SUN = "2026-09-20";

test("平日と休日を、別々に決められる", () => {
  const settings = byGroup({ weekday: 60, holiday: 120 });
  assert.equal(availabilityForDate(settings, MON).available, 60);
  assert.equal(availabilityForDate(settings, WED).available, 60);
  assert.equal(availabilityForDate(settings, SAT).available, 120);
  assert.equal(availabilityForDate(settings, SUN).available, 120);
});

test("平日だけ入れたら、休日も同じ値になる", () => {
  const settings = byGroup({ weekday: 60 });
  assert.equal(availabilityForDate(settings, MON).available, 60);
  assert.equal(availabilityForDate(settings, SAT).available, 60, "休日に使われていない");
  assert.equal(availabilityForDate(settings, SAT).source, "weekly_spread");
  assert.match(availabilityForDate(settings, SAT).note, /ほかの曜日に入れた値/);
});

test("休日だけ入れたら、平日も同じ値になる", () => {
  const settings = byGroup({ holiday: 90 });
  assert.equal(availabilityForDate(settings, MON).available, 90);
  assert.equal(availabilityForDate(settings, SAT).available, 90);
});

test("休日は勉強しないなら、休日に 0 と入れる", () => {
  const settings = byGroup({ weekday: 60, holiday: 0 });
  assert.equal(availabilityForDate(settings, MON).available, 60);
  assert.equal(availabilityForDate(settings, SAT).available, 0);
  assert.equal(availabilityForDate(settings, SAT).configured, true, "0分が未設定になっている");
});

test("ひとつも入れていなければ、未設定のまま", () => {
  const settings = byGroup();
  assert.equal(availabilityForDate(settings, MON).available, null);
  assert.equal(availabilityForDate(settings, MON).source, "not_configured");
  assert.equal(availabilityForDate(settings, MON).configured, false);
});

test("0分だけを入れた場合も、全部の日が0分になる", () => {
  const settings = byGroup({ weekday: 0 });
  assert.equal(availabilityForDate(settings, SAT).available, 0);
  assert.equal(availabilityForDate(settings, SAT).configured, true);
});

test("前の版で曜日ごとに書き分けた設定も、そのまま読める", () => {
  // 値が2種類あるので、書いていない曜日には広げない（書き分けた意図を尊重する）。
  const settings = weekly({ mon: 60, wed: 90 });
  assert.equal(availabilityForDate(settings, MON).available, 60);
  assert.equal(availabilityForDate(settings, WED).available, 90);
  assert.equal(availabilityForDate(settings, SAT).source, "not_configured");
});

test("今日は、計測できた学習時間を引く", () => {
  const settings = byGroup({ weekday: 60 });
  const today = availabilityForDate(settings, MON, { spentSeconds: 20 * 60, isToday: true });
  assert.equal(today.available, 40);
  assert.equal(today.spentSubtracted, true);
  // 今日でない日からは引かない。
  assert.equal(availabilityForDate(settings, WED, { spentSeconds: 20 * 60 }).available, 60);
});

test("引きすぎてもマイナスにはしない", () => {
  const settings = byGroup({ weekday: 30 });
  assert.equal(availabilityForDate(settings, MON, { spentSeconds: 120 * 60, isToday: true }).available, 0);
});

test("groupValue は、その群がそろっているときだけ値を返す", () => {
  assert.equal(groupValue(byGroup({ weekday: 60 }).weekly, WEEKDAY_GROUPS[0].days), 60);
  assert.equal(groupValue(byGroup({ weekday: 60 }).weekly, WEEKDAY_GROUPS[1].days), null);
  // 群の中で食い違っていれば null（前の版で曜日ごとに決めた設定）。
  assert.equal(groupValue(weekly({ mon: 60, tue: 90 }).weekly, WEEKDAY_GROUPS[0].days), null);
});

test("fallbackWeeklyValue は、値が1種類のときだけ返す", () => {
  assert.equal(fallbackWeeklyValue(byGroup({ weekday: 60 }).weekly), 60);
  assert.equal(fallbackWeeklyValue(byGroup({ weekday: 0 }).weekly), 0);
  assert.equal(fallbackWeeklyValue(byGroup({ weekday: 60, holiday: 120 }).weekly), null);
  assert.equal(fallbackWeeklyValue(byGroup().weekly), null);
});
