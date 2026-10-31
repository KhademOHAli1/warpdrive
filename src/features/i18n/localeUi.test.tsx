import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(auth)/login/page";
import { LocaleProvider } from "./LocaleProvider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

describe("localized sign-in", () => {
  it("renders the saved Farsi authentication shell before available methods load", async () => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="fa">{await LoginPage({})}</LocaleProvider>,
    );
    expect(html).toContain("ورود به Warpdrive");
    expect(html).toContain("از یکی از روش‌های ورودی استفاده کنید که مدیر فضای کاری فعال کرده است.");
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain("Sign in to Warpdrive");
  });

  it("keeps the English authentication shell available", async () => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="en">{await LoginPage({})}</LocaleProvider>,
    );
    expect(html).toContain("Sign in to Warpdrive");
    expect(html).toContain("Use a sign-in method enabled by your workspace administrator.");
    expect(html).toContain('dir="ltr"');
  });

  it("renders the German authentication shell without an English fallback", async () => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="de">{await LoginPage({})}</LocaleProvider>,
    );
    expect(html).toContain("Bei Warpdrive anmelden");
    expect(html).toContain(
      "Verwenden Sie eine von Ihrer Administration freigegebene Anmeldemethode.",
    );
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain("Use a sign-in method");
  });
});
