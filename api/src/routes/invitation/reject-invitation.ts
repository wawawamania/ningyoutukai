import { Elysia, t } from "elysia";
import { authGuard } from "../../lib/auth-guard";
import {
  InvitationSchema,
  MessageSchema,
  respondToInvitation,
  toInvitationView,
} from "../../lib/invitation";

// 招待拒否 POST /api/invitation/:invitationId/reject
// 自分宛ての保留中の招待を拒否する(メンバーにはならない)。404 / 409 の扱いは承認と同じ。
export const rejectInvitation = new Elysia({ name: "invitation-reject-invitation" })
  .use(authGuard)
  .post(
    "/api/invitation/:invitationId/reject",
    async ({ params, user, status }) => {
      const result = await respondToInvitation(params.invitationId, user, false);
      if (result.kind === "not_found") return status(404, { message: "招待が見つかりません" });
      if (result.kind !== "ok") {
        return status(409, { message: "この招待にはすでに回答済みです" });
      }
      return status(200, toInvitationView(result.invitation));
    },
    {
      requireUser: true,
      params: t.Object({ invitationId: t.String({ format: "uuid" }) }),
      response: { 200: InvitationSchema, 404: MessageSchema, 409: MessageSchema },
      detail: { summary: "招待拒否" },
    }
  );
