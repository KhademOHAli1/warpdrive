import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { actionErrorContent } from "./actionError";

for (const locale of ["fa", "de", "en"] as const)
  it(`distinguishes uncertain and partial remote effects from a failed save in ${locale}`, () => {
    const generic = actionErrorContent(undefined, locale);
    const unknown = actionErrorContent(ERROR_IDS.MAIL_WRITE_UNKNOWN, locale);
    const partial = actionErrorContent(ERROR_IDS.MAIL_WRITE_PARTIAL, locale);
    expect(unknown.title).not.toBe(generic.title);
    expect(unknown.body).not.toBe(generic.body);
    expect(partial.body).not.toBe(unknown.body);
  });
