import { describe, expect, it } from "vitest";
import { findPersonMatches, type PersonMatchOption } from "./personMatch";

const OPTIONS: PersonMatchOption[] = [
  {
    id: "p1",
    name: "Steve Tomkiel",
    emails: ["Steve.Tomkiel@sdmts.com"],
    phones: ["+1 (619) 555-0134"],
  },
  { id: "p2", name: "Kali Reyes", emails: ["kali@lametro.net"], phones: [] },
  { id: "p3", name: "No Contact Points", emails: [], phones: [] },
];

const EMPTY = { name: "", email: "", phone: "" };

describe("findPersonMatches", () => {
  it("matches an email regardless of case", () => {
    const m = findPersonMatches({ ...EMPTY, email: "steve.tomkiel@SDMTS.com" }, OPTIONS);
    expect(m).toEqual([{ option: OPTIONS[0], reason: "email" }]);
  });

  it("matches a phone despite different punctuation and spacing", () => {
    const m = findPersonMatches({ ...EMPTY, phone: "619-555-0134" }, OPTIONS);
    expect(m).toEqual([{ option: OPTIONS[0], reason: "phone" }]);
  });

  it.each([
    ["+1 (619) 555-0134", "۶۱۹-۵۵۵-۰۱۳۴"],
    ["+۱ (۶۱۹) ۵۵۵-۰۱۳۴", "619-555-0134"],
    ["+1 (619) 555-0134", "٦١٩-٥٥٥-٠١٣٤"],
    ["+١ (٦١٩) ٥٥٥-٠١٣٤", "619-555-0134"],
    ["+۱ (۶۱۹) ۵۵۵-۰۱۳۴", "٦١٩-٥٥٥-٠١٣٤"],
    ["+1 (۶١9) ۵٥5-۰١3۴", "۶1٩-5۵٥-0۱٣4"],
  ])("matches stored %s against %s without rewriting the stored phone", (stored, typed) => {
    const option = { id: "mixed-phone", name: "", emails: [], phones: [stored] };

    const matches = findPersonMatches({ ...EMPTY, phone: typed }, [option]);

    expect(matches).toEqual([{ option, reason: "phone" }]);
    expect(matches[0]?.option).toBe(option);
    expect(option.phones).toEqual([stored]);
  });

  it("keeps the seven-digit floor after normalizing every digit script", () => {
    expect(findPersonMatches({ ...EMPTY, phone: "۵۵۵۰۱۳۴" }, OPTIONS)).toEqual([
      { option: OPTIONS[0], reason: "phone" },
    ]);
    expect(findPersonMatches({ ...EMPTY, phone: "٥٥٠١٣٤" }, OPTIONS)).toEqual([]);
    const shortStored = { id: "short", name: "", emails: [], phones: ["۵۵۰۱۳۴"] };
    expect(findPersonMatches({ ...EMPTY, phone: "6195550134" }, [shortStored])).toEqual([]);
  });

  it.each([
    ["+1 (619) 555-0134 x۹۹", "6195550134"],
    ["+1 (619) 555-0134 x٩٩", "6195550134"],
    ["+1 (619) 555-0134", "6195550134 x۹۹"],
    ["+1 (619) 555-0134", "6195550134 x٩٩"],
  ])("does not discard extension digits when comparing %s with %s", (stored, typed) => {
    const option = { id: "extension", name: "", emails: [], phones: [stored] };

    expect(findPersonMatches({ ...EMPTY, phone: typed }, [option])).toEqual([]);
    expect(option.phones).toEqual([stored]);
  });

  it("matches a near-duplicate name the way the Add deal combobox does", () => {
    const m = findPersonMatches({ ...EMPTY, name: "Kali Reyez" }, OPTIONS);
    expect(m).toEqual([{ option: OPTIONS[1], reason: "name" }]);
  });

  it("reports a person once, by its strongest signal, when several fields point at them", () => {
    const m = findPersonMatches(
      { name: "Steve Tomkiel", email: "steve.tomkiel@sdmts.com", phone: "6195550134" },
      OPTIONS,
    );
    expect(m).toEqual([{ option: OPTIONS[0], reason: "email" }]);
  });

  it("suggests nothing for an empty draft", () => {
    expect(findPersonMatches(EMPTY, OPTIONS)).toEqual([]);
  });

  it("does not treat a too-short digit string as a phone match", () => {
    // A handful of digits (an extension, a street number) would otherwise collide with any number
    // sharing them, so short inputs must not suggest anyone.
    expect(findPersonMatches({ ...EMPTY, phone: "0134" }, OPTIONS)).toEqual([]);
  });

  it("does not match a partial email fragment", () => {
    expect(findPersonMatches({ ...EMPTY, email: "steve" }, OPTIONS)).toEqual([]);
  });
});

it("never treats an explicit foreign country code as the same complete international number", () => {
  const foreign = { id: "foreign", name: "", emails: [], phones: ["+49 989123456789"] };
  expect(findPersonMatches({ name: "", email: "", phone: "+98 9123456789" }, [foreign])).toEqual(
    [],
  );
});

it("matches an Iranian national number only using its selected region and keeps multiple candidates for manual review", () => {
  const a = { id: "a", name: "", emails: [], phones: ["+98 9123456789"] };
  const b = { ...a, id: "b" };
  expect(
    findPersonMatches({ name: "", email: "", phone: "۰۹۱۲۳۴۵۶۷۸۹", phoneCountry: "IR" }, [a, b]),
  ).toEqual([
    { option: a, reason: "phone" },
    { option: b, reason: "phone" },
  ]);
});
