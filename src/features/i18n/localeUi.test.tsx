import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LoginPage from "@/app/(auth)/login/page";
import { LocaleProvider } from "./LocaleProvider";

describe("localized sign-in", () => {
  it("renders the saved Farsi sign-in language without a standalone language setting", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="fa">
        <LoginPage />
      </LocaleProvider>,
    );
    expect(html).toContain("ورود با حساب گوگل");
    expect(html).toContain("حساب \u2066Google Workspace\u2069 سازمان خود");
    expect(html).not.toContain("تغییر زبان به انگلیسی");
  });

  it("keeps the English sign-in experience available", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="en">
        <LoginPage />
      </LocaleProvider>,
    );
    expect(html).toContain("Sign in with Google");
    expect(html).not.toContain("Switch language to Persian");
  });
});
