import { describe, expect, it, vi } from "vitest";

const cookieValue = vi.hoisted(() => ({ value: "en" }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: cookieValue.value }) }),
}));
vi.mock("@/features/i18n/server", () => ({
  getLocalePreferences: () =>
    Promise.resolve({
      locale: cookieValue.value,
      calendar: "gregory",
      timeZone: "UTC",
    }),
}));

// next/font/local is compiled by the Next.js build loader and cannot run under Vitest, so we stub
// it. The stub returns a sentinel `variable` class; the layout must apply that class to the document
// root so Tailwind's `--font-sans` resolves to Inter. This asserts the WIRING (font var is attached),
// which is the part that silently breaks, not the font bytes.
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "__inter_sentinel_var", className: "__inter_sentinel_class" }),
}));
vi.mock("@/components/providers", () => ({
  Providers: ({ children }: { children: React.ReactNode }) => children,
}));

describe("root layout", () => {
  it("applies the Inter font variable class to the document root", async () => {
    const { default: RootLayout } = await import("./layout");
    const tree = (await RootLayout({ children: null })) as { props: { className?: string } };
    expect(tree.props.className).toContain("__inter_sentinel_var");
    // Keeps the existing antialiasing hint.
    expect(tree.props.className).toContain("antialiased");
  });

  it("renders the selected language and direction on the initial document", async () => {
    cookieValue.value = "fa";
    const { default: RootLayout } = await import("./layout");
    const tree = (await RootLayout({ children: null })) as {
      props: { lang?: string; dir?: string };
    };
    expect(tree.props.lang).toBe("fa");
    expect(tree.props.dir).toBe("rtl");
    cookieValue.value = "en";
  });
});
