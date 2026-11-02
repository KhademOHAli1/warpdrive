import { expect, it } from "vitest";
import { sendEmailInput } from "./send";

it("accepts bare Farsi mailbox addresses and rejects header injection", () => {
  const base = {
    accountId: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "00000000-0000-4000-8000-000000000002",
    to: ["کاربر@مثال.ایران"],
    subject: "پیشنهاد همکاری",
    bodyHtml: "<p>Grüße</p>",
  };
  expect(sendEmailInput.safeParse(base).success).toBe(true);
  expect(
    sendEmailInput.safeParse({ ...base, to: ["owner@mail.test\r\nBcc: hidden@mail.test"] }).success,
  ).toBe(false);
});
