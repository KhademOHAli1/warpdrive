// @vitest-environment jsdom
import "./__fixtures__/ReviewerVerificationStartTestKit";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Locale } from "@/features/i18n/registry";
import type { NumberingSystem } from "@/lib/numberingSystem";
import {
  CASE,
  labels,
  loadAndClaim,
  mocks,
  mountReviewer,
  press,
  resetVerificationStart,
} from "./__fixtures__/ReviewerVerificationStartTestKit";
import { ReviewerIntakeCard } from "./ReviewerIntakeCard";

beforeEach(resetVerificationStart);
afterEach(cleanup);

const presentations: { locale: Locale; numberingSystem: NumberingSystem }[] = [
  { locale: "en", numberingSystem: "latn" },
  { locale: "de", numberingSystem: "latn" },
  { locale: "fa", numberingSystem: "arabext" },
  { locale: "fa", numberingSystem: "latn" },
];
test.each(presentations)(
  "$locale/$numberingSystem keeps warning/history localized, direction and selected date digits",
  async ({ locale, numberingSystem }) => {
    const subject = mountReviewer((props) => <ReviewerIntakeCard {...props} />, {
      locale,
      numberingSystem,
    });
    await loadAndClaim(locale);
    const L = labels[locale];
    const title = screen.getByRole("heading", { name: L.title });
    expect(title.closest("[dir]")).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr");
    expect(screen.getByText(L.warning)).toBeInTheDocument();
    const date = subject.view.container.querySelector("time");
    expect(date).toHaveAttribute("datetime", "2026-03-21T00:30:00.000Z");
    if (numberingSystem === "arabext") expect(date?.textContent).toMatch(/[۰-۹]/u);
    else {
      expect(date?.textContent).toMatch(/[0-9]/u);
      expect(date?.textContent).not.toMatch(/[۰-۹]/u);
    }
    for (const reference of screen.getAllByText(CASE))
      expect(reference).toHaveAttribute("dir", "ltr");
    expect(mocks.transition).not.toHaveBeenCalled();
    await press(L.start);
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    expect(screen.getByText(L.recorded)).toBeInTheDocument();
    expect(screen.getByText(L.historical)).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  },
);
