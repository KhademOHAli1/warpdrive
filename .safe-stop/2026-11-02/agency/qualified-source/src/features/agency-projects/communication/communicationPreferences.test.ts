import { describe, expect, it } from "vitest";
import { parseCommunicationPreferenceRequest } from "./communicationPreferences";

const projectId = "cdefabcd-3456-4cde-abcd-345678901abc";
const personId = "bcdefabc-2345-4bcd-9efa-234567890abc";
const mutationIntentId = "faabcdef-6789-4bcd-9efa-678901234abc";
const conversationReference = "https://chat.example.invalid/Project/مدل?room=A%2Fb#Teil-1";

function request() {
  return {
    mutationIntentId,
    preference: {
      projectId,
      personId,
      role: "هماهنگ‌کننده پروژه / Projektkoordination",
      channel: { kind: "email" as const },
      cadence: { kind: "unspecified" as const },
      conversationReference,
    },
  };
}

function expectInvalid(input: unknown) {
  expect(parseCommunicationPreferenceRequest(input)).toEqual({
    ok: false,
    error: "invalid_communication_preference",
  });
}

describe("proposed communication preference request boundary", () => {
  it("requires a strict object envelope and one preference body", () => {
    for (const input of [
      null,
      [],
      {},
      { mutationIntentId },
      { mutationIntentId, preference: null },
    ]) {
      expectInvalid(input);
    }
  });

  it("retains one contextual preference and exact external conversation reference", () => {
    const input = request();
    expect(parseCommunicationPreferenceRequest(input)).toEqual({ ok: true, value: input });
  });

  it("canonicalizes project/person/intent UUIDs without changing authored text or references", () => {
    const input = request();
    expect(
      parseCommunicationPreferenceRequest({
        ...input,
        mutationIntentId: mutationIntentId.toUpperCase(),
        preference: {
          ...input.preference,
          projectId: projectId.toUpperCase(),
          personId: personId.toUpperCase(),
        },
      }),
    ).toEqual({ ok: true, value: input });
  });

  it("requires a stable mutation-intent UUID in the future browser envelope", () => {
    const missing = request();
    Reflect.deleteProperty(missing, "mutationIntentId");
    expectInvalid(missing);
    for (const invalid of ["", "intent-one", null])
      expectInvalid({ ...request(), mutationIntentId: invalid });
  });

  it("requires canonical project and person references, not names or addresses", () => {
    for (const field of ["projectId", "personId"] as const) {
      for (const invalid of ["", "same-name", "shared@example.invalid", null]) {
        expectInvalid({ ...request(), preference: { ...request().preference, [field]: invalid } });
      }
    }
  });

  it("keeps independent people and role/channel contexts intact across separate declarations", () => {
    const first = request();
    const samePersonOtherContext = {
      mutationIntentId: "abcdef12-7890-4cde-abcd-789012345abc",
      preference: {
        ...first.preference,
        role: "مسئول تأیید محتوا / Inhaltliche Freigabe",
        channel: { kind: "whatsapp" },
      },
    };
    const differentPersonSameRole = {
      mutationIntentId: "fedcba98-8765-4def-bcde-876543210abc",
      preference: { ...first.preference, personId: "efabcdef-5678-4abc-8def-567890123abc" },
    };
    for (const input of [first, samePersonOtherContext, differentPersonSameRole]) {
      expect(parseCommunicationPreferenceRequest(input)).toEqual({ ok: true, value: input });
    }
  });

  it.each(["email", "phone", "whatsapp", "meeting"])(
    "requires the explicitly declared %s channel",
    (kind) => {
      const input = { ...request(), preference: { ...request().preference, channel: { kind } } };
      expect(parseCommunicationPreferenceRequest(input)).toEqual({ ok: true, value: input });
    },
  );

  it("supports a bounded other-channel label as unresolved plain data", () => {
    const input = {
      ...request(),
      preference: {
        ...request().preference,
        channel: { kind: "other", label: "تلگرام / Telegram" },
      },
    };
    expect(parseCommunicationPreferenceRequest(input)).toEqual({ ok: true, value: input });
    for (const channel of [
      { kind: "other" },
      { kind: "other", label: " " },
      { kind: "other", label: "x".repeat(81) },
      { kind: "other", label: "نام\u0000" },
      { kind: "other", label: "Name\u0085" },
    ]) {
      expectInvalid({ ...request(), preference: { ...request().preference, channel } });
    }
  });

  it("does not guess a missing or unknown channel", () => {
    const input = request();
    Reflect.deleteProperty(input.preference, "channel");
    expectInvalid(input);
    for (const channel of [
      null,
      "email",
      { kind: "automatic" },
      { kind: "whatsapp", syncGroup: true },
    ]) {
      expectInvalid({ ...request(), preference: { ...request().preference, channel } });
    }
  });

  it("keeps unspecified, explicit none and a declared cadence distinct", () => {
    for (const cadence of [
      { kind: "unspecified" },
      { kind: "none" },
      { kind: "declared", text: "هر سه‌شنبه، بعد از هماهنگی / Dienstags nach Rücksprache" },
    ]) {
      const input = { ...request(), preference: { ...request().preference, cadence } };
      expect(parseCommunicationPreferenceRequest(input)).toEqual({ ok: true, value: input });
    }
  });

  it("requires an explicit cadence state and rejects ambiguous or executable cadence shapes", () => {
    const input = request();
    Reflect.deleteProperty(input.preference, "cadence");
    expectInvalid(input);
    for (const cadence of [
      null,
      "weekly",
      { kind: "declared" },
      { kind: "none", text: "weekly" },
      { kind: "declared", text: "weekly", cron: "0 9 * * 1" },
    ]) {
      expectInvalid({ ...request(), preference: { ...request().preference, cadence } });
    }
  });

  it("preserves authored plain role/cadence text, Persian digits and ordinary cadence newlines", () => {
    const input = {
      ...request(),
      preference: {
        ...request().preference,
        role: "  هماهنگ‌کننده <تیم> / Kontakt <Projekt>  ",
        cadence: {
          kind: "declared",
          text: "  هر ۲ هفته، پس از هماهنگی\nNach Rücksprache <intern>  ",
        },
      },
    };
    expect(parseCommunicationPreferenceRequest(input)).toEqual({ ok: true, value: input });
  });

  it("bounds staff-authored text and rejects blank/control-containing role or cadence data", () => {
    const missingRole = request();
    Reflect.deleteProperty(missingRole.preference, "role");
    expectInvalid(missingRole);
    for (const role of [
      "",
      " \t",
      "x".repeat(161),
      "Role\nOther",
      "نقش\u0000",
      "Rolle\u0085",
      "Role\u2028Other",
    ]) {
      expectInvalid({ ...request(), preference: { ...request().preference, role } });
    }
    for (const text of [
      "",
      " \r\n",
      "x".repeat(1001),
      "زمان\u0000",
      "Termin\u0085",
      "Text\u2029Other",
    ]) {
      expectInvalid({
        ...request(),
        preference: { ...request().preference, cadence: { kind: "declared", text } },
      });
    }
  });

  it("rejects format-only text without banning embedded Persian joiners or rewriting source strings", () => {
    for (const value of ["\u200c", "\u2066\u2069"]) {
      expectInvalid({ ...request(), preference: { ...request().preference, role: value } });
      expectInvalid({
        ...request(),
        preference: { ...request().preference, channel: { kind: "other", label: value } },
      });
      expectInvalid({
        ...request(),
        preference: { ...request().preference, cadence: { kind: "declared", text: value } },
      });
    }
    for (const label of ["گفت‌وگو / Austausch", "\u2066Telegram\u2069"]) {
      const input = {
        ...request(),
        preference: { ...request().preference, channel: { kind: "other", label } },
      };
      expect(parseCommunicationPreferenceRequest(input)).toEqual({ ok: true, value: input });
    }
  });

  it("permits an omitted conversation reference without inventing one", () => {
    const input = request();
    Reflect.deleteProperty(input.preference, "conversationReference");
    expect(parseCommunicationPreferenceRequest(input)).toEqual({ ok: true, value: input });
    expectInvalid({
      ...request(),
      preference: { ...request().preference, conversationReference: "r".repeat(2049) },
    });
  });

  it.each([
    "",
    null,
    "javascript:alert(1)",
    "file:///tmp/conversation",
    "//example.invalid/group",
    "https://user:pass@example.invalid/group",
    "ref\u0085one",
  ])("rejects an unsafe or empty conversation reference: %s", (reference) => {
    expectInvalid({
      ...request(),
      preference: { ...request().preference, conversationReference: reference },
    });
  });

  it("rejects locale/scheduling, identity mutation, auth, recipient and execution shortcuts", () => {
    for (const extra of [
      { locale: "fa" },
      { timezone: "Asia/Tehran" },
      { calendar: "persian" },
      { nextUpdateAt: "2026-11-02T09:00:00Z" },
      { name: "Shared Name" },
      { email: "shared@example.invalid" },
      { phone: "+000000000" },
      { recipient: "shared@example.invalid" },
      { mailboxAccountId: personId },
      { recordedByUserId: personId },
      { authUserId: personId },
      { send: true },
      { syncGroup: true },
      { grantAccess: true },
    ])
      expectInvalid({ ...request(), preference: { ...request().preference, ...extra } });
    expectInvalid({ ...request(), action: "send" });
    expectInvalid({ ...request(), recordedByUserId: personId });
    expectInvalid({
      ...request(),
      preference: {
        ...request().preference,
        channel: { kind: "email", address: "shared@example.invalid" },
      },
    });
  });
});
