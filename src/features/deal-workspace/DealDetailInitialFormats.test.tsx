// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { DealDetailInitialFormatsProvider } from "./DealDetailInitialFormats";
import { DealKeyFacts } from "./header/DealKeyFacts";
import type { DealWorkspace } from "./summaryRepo";

it("hydrates deal detail with its server currency and date before applying browser ICU", async () => {
  const workspace = {
    deal: { value: "0", currency: "EUR", expectedCloseDate: "2026-11-13" },
    org: null,
  } as DealWorkspace;
  const view = (
    <LocaleProvider locale="en" country="DE" timeZone="Europe/Berlin">
      <DealDetailInitialFormatsProvider
        initial={{
          summaryValue: "0 € EUR",
          headerValue: "0 €",
          expectedCloseDate: "13. Nov 2026",
          createdDate: "13. Nov 2026",
        }}
      >
        <DealKeyFacts workspace={workspace} />
      </DealDetailInitialFormatsProvider>
    </LocaleProvider>
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(view);
  expect(container.textContent).toContain("0 €");
  expect(container.textContent).toContain("13. Nov 2026");

  const numberFormat = Intl.NumberFormat;
  const dateTimeFormat = Intl.DateTimeFormat;
  Intl.NumberFormat = new Proxy(numberFormat, {
    construct(target, [locale, options]: ConstructorParameters<typeof Intl.NumberFormat>) {
      const formatter = new target(locale, options);
      if (options?.style === "currency")
        Object.defineProperty(formatter, "format", { value: () => "€0" });
      return formatter;
    },
  });
  Intl.DateTimeFormat = new Proxy(dateTimeFormat, {
    construct(target, [locale, options]: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      const formatter = new target(locale, options);
      if (options?.month === "short")
        Object.defineProperty(formatter, "format", { value: () => "13 Nov 2026" });
      return formatter;
    },
  });

  const recoverable = vi.fn();
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, view, { onRecoverableError: recoverable });
      await Promise.resolve();
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.textContent).toContain("€0");
    expect(container.textContent).toContain("13 Nov 2026");
  } finally {
    act(() => root?.unmount());
    Intl.NumberFormat = numberFormat;
    Intl.DateTimeFormat = dateTimeFormat;
  }
});
