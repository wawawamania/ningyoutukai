import { expect, test } from "bun:test";

// preload(tests/setup.ts)が RESEND_API_KEY を消していること = テストでメールが実送信されないことを固定する
test("テストでは RESEND_API_KEY が未設定で、メールを実際には送らない", () => {
  expect(process.env.RESEND_API_KEY).toBeUndefined();
  expect(process.env.MAIL_FROM).toBeUndefined();
});
