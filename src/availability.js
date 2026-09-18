// 「1日に何分、学習に使えるか」を扱う。
//
// 時刻の入った時間割は作らない。1日あたりの分数だけで計画する。
// 決めるのは「平日」と「休日」の2つだけにしてある。
//
// 例外の日（今日だけ0分にする、今日はあと30分、予備の時間を空ける）は用意しない。
// 予定どおりに進まなかった日は、次に開いたときに自動で組み直される。
// 細かく手で直すより、そのほうが手間がない。
//
// 大事な決めごと:
//
//   ・「未設定」と「0分」は別物として扱う。
//     未設定の日は available を null で返し、使える時間を勝手に決めない。
//     計画を作る側は、未設定の日には予定を置かない。
//
//   ・設定した値が1種類だけなら、書いていない曜日にもその値を使う。
//     平日だけ入れれば休日も同じ扱いになり、両方書かなくてよい。
//     休日は勉強しないなら、休日に 0 と書けばよい。
//
//   ・今日については、その日にすでに計測できた学習時間を引く。
//     アプリの外で解いた分は分からないので、そこは引けない。

export const WEEKDAY_KEYS = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

export const WEEKDAY_LABELS = Object.freeze({
  sun: '日', mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土',
});

/**
 * 画面で決めてもらう単位。曜日を7つ書かせるのは手間なだけなので、
 * 「平日」と「休日」の2つにまとめる。保存はこれまでどおり曜日ごとに持つので、
 * 前の版で曜日別に決めた設定も、そのまま読める。
 */
export const WEEKDAY_GROUPS = Object.freeze([
  { key: 'weekday', label: '平日', days: Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri']) },
  { key: 'holiday', label: '休日', days: Object.freeze(['sat', 'sun']) },
]);

export const DEFAULT_AVAILABILITY = Object.freeze({
  // すべて未設定から始める。勝手に「1日60分」などと決めない。
  weekly: Object.freeze({ sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null }),
  updatedAt: null,
  revision: 0,
});

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const readMinutes = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1440, Math.round(number)));
};

export function normalizeAvailability(raw) {
  const source = isObject(raw) ? raw : {};
  const weekly = {};
  for (const key of WEEKDAY_KEYS) {
    weekly[key] = readMinutes(isObject(source.weekly) ? source.weekly[key] : null);
  }
  return {
    weekly,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
    revision: Number.isFinite(Number(source.revision)) ? Math.max(0, Math.floor(Number(source.revision))) : 0,
  };
}

/**
 * ひとつの群（平日／休日）に入っている値。
 * 群の中で食い違っていれば null を返す（前の版で曜日別に決めた設定を読んだとき）。
 */
export function groupValue(weekly, days) {
  const values = days.map((day) => weekly?.[day] ?? null);
  const first = values[0];
  return values.every((value) => value === first) ? first : null;
}

/**
 * 書いていない曜日に使う値。
 *
 * 設定した値が1種類だけならそれを使い、2種類以上あるなら null
 * （書き分けたとみなし、空欄は未設定のままにする）。
 */
export function fallbackWeeklyValue(weekly) {
  const values = new Set(WEEKDAY_KEYS
    .map((key) => weekly?.[key] ?? null)
    .filter((value) => value !== null));
  return values.size === 1 ? [...values][0] : null;
}

export const weekdayKeyOf = (dateKey) => {
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return WEEKDAY_KEYS[new Date(ms).getUTCDay()];
};

/**
 * その日に使える時間を出す。
 *
 * 返すもの:
 *   available      … 使える分（未設定なら null）
 *   source         … weekly=その曜日に書いた値 / weekly_spread=書いていないので他から借りた値
 *                    not_configured=未設定
 *   spentMinutes   … その日にすでに計測できた学習時間
 *   note           … 画面にそのまま出せる一言
 */
export function availabilityForDate(availability, dateKey, { spentSeconds = 0, isToday = false } = {}) {
  const settings = normalizeAvailability(availability);
  const spentMinutes = Math.round(Math.max(0, spentSeconds) / 60);

  const own = settings.weekly[weekdayKeyOf(dateKey)] ?? null;
  const borrowed = own === null ? fallbackWeeklyValue(settings.weekly) : null;
  const base = own !== null ? own : borrowed;

  if (base === null) {
    return {
      date: dateKey,
      available: null,
      rawMinutes: null,
      source: 'not_configured',
      spentMinutes,
      spentSubtracted: false,
      configured: false,
      note: '学習に使える時間が未設定です（0分とは違います）。設定するまで予定を置きません。',
    };
  }

  // 今日だけは、その日にすでに計測できた学習時間を引く。
  const used = isToday ? spentMinutes : 0;
  const available = Math.max(0, base - used);
  return {
    date: dateKey,
    available,
    rawMinutes: base,
    source: own !== null ? 'weekly' : 'weekly_spread',
    spentMinutes,
    spentSubtracted: isToday,
    configured: true,
    note: isToday
      ? `${base}分から、計測できた学習${spentMinutes}分を引いた残りです。アプリの外で解いた分は分かりません。`
      : `${base}分${own === null ? '（ほかの曜日に入れた値を使っています）' : ''}。`,
  };
}
