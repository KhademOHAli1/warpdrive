import { expect, it } from "vitest";
import { phonePointSchema } from "./schemas";

it("preserves exact phone input while deriving trusted E.164 metadata from the explicitly selected country", () => {
  const raw = " ۰۹۱۲ ۳۴۵ ۶۷۸۹ ";
  expect(
    phonePointSchema.parse({
      label: "mobile",
      value: raw,
      primary: true,
      country: "IR",
      e164: "+493023125000",
    }),
  ).toEqual({
    label: "mobile",
    value: raw,
    primary: true,
    country: "IR",
    e164: "+989123456789",
    normalization: "valid",
  });
});

it("does not accept forged normalized identities for an ambiguous phone", () => {
  const result = phonePointSchema.parse({
    label: "work",
    value: "12345",
    country: "IR",
    e164: "+989123456789",
    normalization: "valid",
  });
  expect(result).toMatchObject({ country: "IR", value: "12345", normalization: "review" });
  expect(result).not.toHaveProperty("e164");
});

it("does not infer a country for an unprefixed legacy phone", () => {
  expect(phonePointSchema.parse({ label: "mobile", value: "۰۹۱۲۳۴۵۶۷۸۹" })).toEqual({
    label: "mobile",
    value: "۰۹۱۲۳۴۵۶۷۸۹",
    primary: false,
  });
});
