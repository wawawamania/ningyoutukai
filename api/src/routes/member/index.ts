import { Elysia } from "elysia";
import { deleteMember } from "./delete-member";
import { getMember } from "./get-member";
import { listMembers } from "./list-members";

/**
 * メンバー管理の API(docs/api.md「メンバー機能」)。
 * エンドポイントごとにファイルを分けている。
 */
export const memberRoutes = new Elysia({ name: "member-routes" })
  .use(listMembers)
  .use(getMember)
  .use(deleteMember);
