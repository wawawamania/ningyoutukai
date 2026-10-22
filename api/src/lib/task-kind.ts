import { t } from "elysia";
import { taskTypes } from "../db/schema";

/** タスクの種類の入力検証・共通の定義(追加・編集で共通)。 */

export const TASK_KIND_NAME_MAX = 50;

// Postgres の text は NUL 文字(\u0000)と、対になっていないサロゲートを保存できない
// (500 になる、または名前が壊れて保存される)ため、入力の時点で弾く。
// サロゲートは、上位+下位の対だけを許す
const VALID_NAME = "^(?:[^\\u0000\\ud800-\\udfff]|[\\ud800-\\udbff][\\udc00-\\udfff])*$";

export const taskKindNameSchema = () =>
  t.String({ maxLength: TASK_KIND_NAME_MAX, pattern: VALID_NAME });

// trim() が空白と見なさないゼロ幅の文字(U+200B〜U+200D、U+2060、U+180E、U+FEFF、U+0085)
const INVISIBLE = /[\u200b-\u200d\u2060\u180e\ufeff\u0085]/g;

/** トリムし、空(ゼロ幅の文字だけも空)なら null を返す。名前の途中のゼロ幅の文字は残す(絵文字の結合に必要) */
export function normalizeTaskKindName(name: string) {
  const trimmed = name.trim();
  return trimmed.replace(INVISIBLE, "").trim() ? trimmed : null;
}

export const taskKindColumns = {
  taskTypeId: taskTypes.taskTypeId,
  taskTypeName: taskTypes.taskTypeName,
  productId: taskTypes.productId,
};

export const taskKindSchema = () =>
  t.Object({
    taskTypeId: t.String(),
    taskTypeName: t.String(),
    productId: t.String(),
  });

export const messageSchema = () => t.Object({ message: t.String() });

// PostgreSQL の unique 制約違反
const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === UNIQUE_VIOLATION || err?.cause?.code === UNIQUE_VIOLATION;
}
