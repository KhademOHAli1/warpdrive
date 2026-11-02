import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GMAIL_ATTACHMENT_LIMITS } from "./emailAttachmentLimits";
import { sendEmailInput } from "./send";

const input = (attachments: Array<{ fileId: string }>) => ({
  accountId: randomUUID(),
  idempotencyKey: randomUUID(),
  to: ["recipient@example.com"],
  subject: "Test",
  bodyHtml: "<p>Test</p>",
  attachments,
});

describe("Gmail attachment request bounds", () => {
  it("accepts distinct attachments within the count limit", () => {
    const attachments = Array.from({ length: GMAIL_ATTACHMENT_LIMITS.count }, () => ({
      fileId: randomUUID(),
    }));
    expect(sendEmailInput.safeParse(input(attachments)).success).toBe(true);
  });

  it("rejects duplicate file IDs before any file lookups", () => {
    const fileId = randomUUID();
    expect(sendEmailInput.safeParse(input([{ fileId }, { fileId }])).success).toBe(false);
  });

  it("rejects attachment counts above the memory budget", () => {
    const attachments = Array.from({ length: GMAIL_ATTACHMENT_LIMITS.count + 1 }, () => ({
      fileId: randomUUID(),
    }));
    expect(sendEmailInput.safeParse(input(attachments)).success).toBe(false);
  });
});
