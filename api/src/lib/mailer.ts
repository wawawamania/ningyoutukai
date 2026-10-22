/**
 * メール送信(Resend の REST API)。通知は補助機能なので、失敗しても API 自体は失敗させない。
 * - `RESEND_API_KEY` が無い(未設定・空文字)ときは送らず、宛先・件名・本文をログに出す(ローカル開発・テスト用)。
 *   ローカルでは `.env.local` で `RESEND_API_KEY=` と空にして使う。本文は、`NODE_ENV=production` では出さない
 * - 送信元は `MAIL_FROM`(例: `人形使い <noreply@example.com>`)
 * - `MAILPIT_URL`(例: `http://localhost:8025`)があるときは、ローカルの受信箱 Mailpit の HTTP 送信 API
 *   (`POST /api/v1/send`)に送る。外には出ない。SMTP は使わない(Workers では生の TCP が使えない)。
 *   Resend より優先。`NODE_ENV=production` では無視する(設定ミスで本番のメールが Mailpit に行かないように)
 *
 * テストでは `spyOn(mailer, "send")` で差し替えて、実際には送らずに呼び出しを検証する。
 */
export type Mail = { to: string | string[]; subject: string; text: string };
export type MailResult = { ok: true } | { ok: false; skipped?: true; error?: string };

/** `名前 <addr>` を Mailpit の { Email, Name } に分ける。`addr` だけでも良い */
export function parseAddress(raw: string): { Email: string; Name?: string } {
  const m = raw.trim().match(/^(.*?)\s*<([^<>]+)>$/);
  if (!m) return { Email: raw.trim() };
  const name = m[1].trim().replace(/^"(.*)"$/, "$1");
  return name ? { Email: m[2].trim(), Name: name } : { Email: m[2].trim() };
}

async function sendToMailpit(baseUrl: string, mail: Mail): Promise<MailResult> {
  try {
    const to = Array.isArray(mail.to) ? mail.to : [mail.to];
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: parseAddress(process.env.MAIL_FROM || "人形使い <noreply@localhost>"),
        To: to.map(parseAddress),
        Subject: mail.subject,
        Text: mail.text,
      }),
    });
    if (!res.ok) {
      const error = `Mailpit ${res.status}: ${await res.text()}`;
      console.error(`[mailer] ${error}`);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[mailer] ${error}`);
    return { ok: false, error };
  }
}

export const mailer = {
  async send(mail: Mail): Promise<MailResult> {
    const mailpitUrl = process.env.MAILPIT_URL;
    if (mailpitUrl && process.env.NODE_ENV !== "production") return sendToMailpit(mailpitUrl, mail);
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      const to = Array.isArray(mail.to) ? mail.to.join(", ") : mail.to;
      const lines = [`[mailer] RESEND_API_KEY が未設定のため送信しません`, `  宛先: ${to}`, `  件名: ${mail.subject}`];
      // 本文には招待リンクなどが入るので、本番(production)のログには出さない
      if (process.env.NODE_ENV !== "production") lines.push(`  本文:\n${mail.text}`);
      console.log(lines.join("\n"));
      return { ok: false, skipped: true };
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM ?? "onboarding@resend.dev",
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
        }),
      });
      if (!res.ok) {
        const error = `Resend ${res.status}: ${await res.text()}`;
        console.error(`[mailer] ${error}`);
        return { ok: false, error };
      }
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[mailer] ${error}`);
      return { ok: false, error };
    }
  },
};
