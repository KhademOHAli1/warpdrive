import { expect, it } from "vitest";
import { isValidMailRecipient } from "./recipientAddress";

for (const address of [
  "owner@example.com",
  "First.Last+tag@sub.example.com",
  "پشتیبانی@مثال.ایران",
  "müller@büro.de",
  "نام‌خانوادگی@مثال.ایران",
  `${"آ".repeat(32)}@example.com`,
])
  it("accepts a valid unquoted ASCII or UTF8 recipient without changing its spelling", () => {
    expect(isValidMailRecipient(address)).toBe(true);
  });
for (const address of [
  "",
  "owner@localhost",
  "owner@@example.com",
  "Owner <owner@example.com>",
  '"owner"@example.com',
  "owner@example.com\r\nBcc: private@example.com",
  "owner\u0000@example.com",
  "owner name@example.com",
  ".owner@example.com",
  "owner..name@example.com",
  "owner@example..com",
  "owner@-example.com",
  "owner@exam_ple.com",
  `${"آ".repeat(33)}@example.com`,
  `${"a".repeat(65)}@example.com`,
  `owner@${"a".repeat(64)}.com`,
  `own\u202eer@example.com`,
])
  it("rejects malformed, over-limit or header/control-bearing recipients", () => {
    expect(isValidMailRecipient(address)).toBe(false);
  });
