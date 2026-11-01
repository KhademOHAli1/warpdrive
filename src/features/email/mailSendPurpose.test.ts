import { describe, expect, it } from "vitest";
import { type NotificationSendPurpose, parseNotificationSendPurpose } from "./mailSendPurpose";

const purpose: NotificationSendPurpose = {
  version: 1,
  kind: "notification",
  notificationId: "ad1a8a31-724f-40fc-9538-48a521934fe7",
  recipientUserId: "592c5d58-d10c-4f84-a602-577f18f4f6d2",
};

describe("persisted notification send purpose", () => {
  it("roundtrips canonical version1 purpose without changing or mutating its values", () => {
    const input: unknown = JSON.parse(JSON.stringify(purpose));
    expect(parseNotificationSendPurpose(input)).toEqual(purpose);
    expect(input).toEqual(purpose);
  });

  it("accepts canonical PostgreSQL UUID values without imposing RFC version or variant restrictions", () => {
    const input = {
      ...purpose,
      notificationId: "00000000-0000-0000-0000-000000000000",
      recipientUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    };
    expect(parseNotificationSendPurpose(input)).toEqual(input);
  });

  it.each([
    undefined,
    null,
    false,
    1,
    "notification",
    [],
    [purpose],
    {},
    { version: 1 },
    { kind: "notification" },
    { ...purpose, version: undefined },
    { ...purpose, version: null },
    { ...purpose, version: "1" },
    { ...purpose, version: 0 },
    { ...purpose, version: 2 },
    { ...purpose, kind: undefined },
    { ...purpose, kind: null },
    { ...purpose, kind: "Notification" },
    { ...purpose, kind: "email" },
    { ...purpose, extra: true },
    { ...purpose, accountId: purpose.recipientUserId },
  ])("rejects malformed shapes, versions, kinds and unknown fields (case %#)", (input) => {
    expect(parseNotificationSendPurpose(input)).toBeNull();
  });

  for (const field of ["notificationId", "recipientUserId"] as const) {
    it(`requires ${field} rather than inventing a default`, () => {
      const input: Record<string, unknown> = { ...purpose };
      delete input[field];
      expect(parseNotificationSendPurpose(input)).toBeNull();
    });

    it.each([
      undefined,
      null,
      123,
      true,
      {},
      [],
      "",
      "not-a-uuid",
      purpose[field].toUpperCase(),
      ` ${purpose[field]}`,
      `${purpose[field]} `,
      `{${purpose[field]}}`,
      purpose[field].replaceAll("-", ""),
      `${purpose[field]}\n`,
      `${purpose[field]}\0`,
    ])(`rejects malformed or noncanonical ${field} without coercion (case %#)`, (value) => {
      expect(parseNotificationSendPurpose({ ...purpose, [field]: value })).toBeNull();
    });
  }
});
