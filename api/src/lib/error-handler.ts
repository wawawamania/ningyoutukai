import { Elysia } from "elysia";

/**
 * エラー時のレスポンスを `{ message: string }` に統一する。
 * `status(...)` で明示的に返した業務エラーは onError を通らないため変更されない。
 */
export const errorHandler = new Elysia({ name: "error-handler" }).onError(
  { as: "global" },
  ({ code, error, status }) => {
    switch (code) {
      case "VALIDATION": {
        // レスポンスがスキーマと合わないのは、利用者の入力ではなくサーバー側のバグ。
        // 「入力が正しくありません」と返すと原因が隠れるので、500 にしてログに残す
        if (error.type === "response") {
          console.error(error);
          return status(500, { message: "サーバーでエラーが発生しました" });
        }
        const fields = [
          ...new Set(
            error.all
              .map((e) => String(e.path ?? "").replace(/^\//, ""))
              .filter((p) => p !== ""),
          ),
        ];
        const message =
          fields.length > 0
            ? `入力が正しくありません: ${fields.join("、")}`
            : "入力が正しくありません";
        return status(422, { message });
      }
      case "PARSE":
        return status(400, { message: "リクエストの形式が正しくありません" });
      case "NOT_FOUND":
        return status(404, { message: "見つかりません" });
      default:
        // 内容(SQL 文やスタックトレース)はサーバー側のログにだけ残す
        console.error(error);
        return status(500, { message: "サーバーでエラーが発生しました" });
    }
  },
);
