import { describe, expect, it } from "vitest";
import { parseNewLead } from "./leadForm";

describe("parseNewLead", () => {
  it("rejects an empty title", () => {
    const r = parseNewLead({ title: "  ", value: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/title/i);
  });

  it("builds a manually-created lead input with defaults", () => {
    const r = parseNewLead({ title: "Acme lead", value: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.title).toBe("Acme lead");
    expect(r.input.value).toBeNull();
    expect(r.input.sourceOrigin).toBe("manually_created");
    expect(r.input.personId).toBeNull();
    expect(r.input.ownerId).toBeUndefined();
  });

  it("preserves supported decimal precision and carries the rich fields", () => {
    const PERSON = "33333333-3333-3333-3333-333333333333";
    const r = parseNewLead({
      title: "Rich",
      value: "1000.005",
      personId: PERSON,
      labels: ["hot", "warm"],
      sourceChannel: "referral",
      expectedCloseDate: "2026-09-01",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.value).toBe(1000.005);
    expect(r.input.personId).toBe(PERSON);
    expect(r.input.labels).toEqual(["hot", "warm"]);
    expect(r.input.sourceChannel).toBe("referral");
    expect(r.input.expectedCloseDate).toBe("2026-09-01");
  });

  it("accepts arbitrary catalog label names (deduped) and drops an unknown channel", () => {
    const r = parseNewLead({
      title: "X",
      value: "",
      labels: ["Enterprise", "Hot", "Hot"],
      sourceChannel: "carrier pigeon",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.labels).toEqual(["Enterprise", "Hot"]);
    expect(r.input.sourceChannel).toBeNull();
  });

  it("rejects a negative value", () => {
    expect(parseNewLead({ title: "X", value: "-3" }).ok).toBe(false);
  });
});

it("normalizes Persian input into canonical numeric values", () => {
  const parsed = parseNewLead({ title: "پیگیری خرید", value: "۱٬۲۳۴٫۵۰" }, "fa");
  expect(parsed.ok && parsed.input.value).toBe(1234.5);
  expect(parsed.ok && parsed.input.sourceOrigin).toBe("manually_created");
});
it("rejects malformed Persian numbers with contextual Persian feedback", () => {
  const parsed = parseNewLead({ title: "پیگیری خرید", value: "۱٬۲۳٫۵" }, "fa");
  expect(parsed).toEqual({ ok: false, error: "یک عدد معتبر وارد کنید" });
});

it("rejects precision beyond the four-decimal storage boundary", () => {
  expect(parseNewLead({ title: "X", value: "1.23456" }).ok).toBe(false);
});
