import { z } from "zod";

export const text = (max = 200) => z.string().trim().max(max).default("");
export const country = z.string().regex(/^[A-Z]{2}$/);
export const optionalCountry = country.or(z.literal("")).default("");
export const email = z.email().max(254).or(z.literal("")).default("");
export const webUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (value === "") return true;
    try {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        url.hostname !== "" &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Invalid website URL")
  .default("");
export const contactSchema = z.strictObject({
  name: text(),
  role: z
    .enum([
      "executive",
      "billing",
      "support",
      "security",
      "privacy",
      "finance",
      "procurement",
      "other",
    ])
    .default("other"),
  email,
  phone: text(60),
  purpose: text(500),
});
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const companyDetailsSchema = z.strictObject({
  companyName: z.string().trim().min(1).max(200),
  website: webUrl,
  industry: text(),
  industryTags: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  industryCode: z
    .strictObject({
      scheme: z.string().trim().min(1).max(40),
      version: text(40),
      code: z.string().trim().min(1).max(40),
    })
    .nullable()
    .default(null),
  servicesDescription: text(4000),
  employeeBand: z.enum(["", "solo", "2_9", "10_49", "50_249", "250_999", "1000_plus"]).default(""),
  employeeScope: z.enum(["", "entity", "group"]).default(""),
  employeeAsOf: z.iso.date().or(z.literal("")).default(""),
  intendedTeamSize: z.number().int().min(1).max(100000).nullable().default(null),
  operatingCountries: z.array(country).max(100).default([]),
  publicEmail: email,
  publicPhone: text(60),
  socialLinks: z.array(webUrl).max(20).default([]),
  roleContacts: z.array(contactSchema).max(20).default([]),
  locale: z.enum(["", "en", "de", "fa"]).default(""),
  timeZone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        if (value) new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    })
    .default(""),
  dateFormat: text(40),
  numberFormat: text(40),
  businessHours: z
    .array(
      z
        .strictObject({ day: z.number().int().min(0).max(6), opens: clock, closes: clock })
        .refine((v) => v.opens < v.closes, "Closing time must follow opening time"),
    )
    .max(28)
    .default([]),
});
export type CompanyDetails = z.infer<typeof companyDetailsSchema>;
