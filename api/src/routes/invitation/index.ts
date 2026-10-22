import { Elysia } from "elysia";
import { acceptInvitation } from "./accept-invitation";
import { createInvitation } from "./create-invitation";
import { listInvitations } from "./list-invitations";
import { rejectInvitation } from "./reject-invitation";

/**
 * メンバー招待の API(docs/api.md「プロダクト・メンバー機能」の招待まわり)。
 * エンドポイントごとにファイルを分けている。
 */
export const invitationRoutes = new Elysia({ name: "invitation-routes" })
  .use(createInvitation)
  .use(listInvitations)
  .use(acceptInvitation)
  .use(rejectInvitation);
