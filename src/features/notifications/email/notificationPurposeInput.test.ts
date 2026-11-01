import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { sendEmailInput } from "@/features/email/send";

it("does not admit a trusted notification purpose through interactive send input", () => {
  const parsed = sendEmailInput.parse({
    accountId: randomUUID(),
    idempotencyKey: randomUUID(),
    to: ["recipient@example.com"],
    subject: "User message",
    bodyHtml: "<p>Public input</p>",
    systemPurpose: {
      version: 1,
      kind: "notification",
      notificationId: randomUUID(),
      recipientUserId: randomUUID(),
    },
  });
  expect(parsed).not.toHaveProperty("systemPurpose");
});
