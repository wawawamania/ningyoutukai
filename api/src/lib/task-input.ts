import { t } from "elysia";
import { NO_NUL } from "./validation";

/** タスクの入力検証(作成・更新で共通)。 */

export const TASK_NAME_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const TIME_LIMIT_MIN_YEAR = 2000;
export const TIME_LIMIT_MAX_YEAR = 2100;

// 時刻とタイムゾーンつきの ISO 8601(例: 2026-12-01T09:00:00+09:00 / 2026-12-01T00:00:00Z)
const ISO_DATE_TIME =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})$";

export const taskNameSchema = () =>
  t.String({ maxLength: TASK_NAME_MAX, pattern: NO_NUL });

export const descriptionSchema = () =>
  t.String({ maxLength: DESCRIPTION_MAX, pattern: NO_NUL });

export const timeLimitSchema = () => t.String({ pattern: ISO_DATE_TIME });

export const TIME_LIMIT_ERROR = `期限は ${TIME_LIMIT_MIN_YEAR} 年から ${TIME_LIMIT_MAX_YEAR} 年の日時を、ISO 8601 形式(例: 2026-12-01T09:00:00+09:00)で指定してください`;

/**
 * 期限の文字列を Date にする。存在しない日付(2026-02-30 など)や、
 * 範囲(2000〜2100 年)の外なら null を返す。
 */
export function parseTimeLimit(value: string): Date | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  // new Date は 2026-02-30 を 3 月 2 日に繰り上げるので、書かれた年月日と一致するか確かめる
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})/.exec(value) ?? [];
  const check = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    check.getUTCFullYear() !== Number(y) ||
    check.getUTCMonth() !== Number(m) - 1 ||
    check.getUTCDate() !== Number(d)
  ) {
    return null;
  }

  const year = date.getUTCFullYear();
  if (year < TIME_LIMIT_MIN_YEAR || year > TIME_LIMIT_MAX_YEAR) return null;
  return date;
}
