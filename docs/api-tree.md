## ツリー表示

| メソッド・エンドポイント | 名称 | 説明 |
| --- | --- | --- |
| **GET** `/api/product/{productId}/tree` | プロダクト構造取得 | リーダー、メンバー、割り振られたタスク、タスク種類をツリー表示用のデータとして取得する |

### GET `/api/product/{productId}/tree`

- 認証: 必要（`requireUser`）
- 権限: そのプロダクトに所属していること（リーダー・メンバーどちらも可）

#### ステータスコード

| コード | 条件 |
| --- | --- |
| 200 | 取得成功 |
| 401 | 未ログイン |
| 404 | プロダクトが存在しない、または自分が所属していない（存在を漏らさないため区別しない）。本文は `{ "message": "プロダクトが見つかりません" }` |
| 422 | `productId` が uuid ではない |

#### レスポンス（200）

```json
{
  "product": { "productId": "…", "productName": "人形使い" },
  "leader": {
    "productMemberId": "…",
    "userId": "…",
    "userName": "リーダー",
    "avatarUrl": null,
    "role": "leader",
    "tasks": [
      {
        "taskId": "…",
        "taskName": "要件整理",
        "description": null,
        "timeLimit": "2026-10-31T00:00:00.000Z",
        "reportedAt": null,
        "isVisible": true,
        "taskType": { "taskTypeId": "…", "taskTypeName": "デザイン" }
      }
    ]
  },
  "members": [
    {
      "productMemberId": "…",
      "userId": "…",
      "userName": "メンバーA",
      "avatarUrl": "https://…",
      "role": "member",
      "tasks": []
    }
  ]
}
```

| 項目 | 説明 |
| --- | --- |
| `leader` | ツリーの最上部の1人。リーダー自身のタスクも `tasks` に入る |
| `members` | リーダーの下にぶら下がるメンバー。名前順。メンバーだけのプロダクトでは空配列 |
| `tasks` | そのメンバーのタスク。期限が近い順（期限なしは最後）。なければ空配列 |
| `taskType` | タスクの種類。未設定なら `null` |
| `reportedAt` | 値があれば「完了報告済み・リーダー確認待ち」 |
| `timeLimit` | 期限。未設定なら `null` |

#### 含まれるタスクのルール

| ルール | 根拠 |
| --- | --- |
| 完了済み（`completed_at` あり）は含めない | 要件 4-4 |
| `is_visible = false` のタスクは、リーダーと担当者本人にだけ含める。ほかのメンバーが見ても出ない | 要件 4-2 |