// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { autocapturePropertiesForElement } from "posthog-js/lib/src/autocapture";
import { utils } from "posthog-js/rrweb";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS, sessionRecordingOptions } from "@/features/observability/replayMasking";
import { Select } from "./Select";

const PRIVATE = "PRIVATE-RIGHTS-KIND-SENTINEL";
const PUBLIC = "PUBLIC-CONTROL-SENTINEL";
const excluded = `${BLOCK_CLASS} ph-no-capture`;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

function capture(element: Element) {
  return autocapturePropertiesForElement(element, {
    e: new MouseEvent("click", { bubbles: true }),
    maskAllElementAttributes: false,
    maskAllText: false,
    elementsChainAsString: false,
    disableCaptureUrlHashes: false,
  });
}

it.each(["en", "de", "fa"] as const)(
  "excludes %s sensitive options from replay and autocapture after they leave the private card",
  (locale) => {
    render(
      <LocaleProvider locale={locale}>
        <button type="button" data-testid="public-control">
          {PUBLIC}
        </button>
        <div data-testid="private-card" className={excluded}>
          <Select
            value="access"
            onChange={vi.fn()}
            options={[{ value: "access", label: PRIVATE }]}
            ariaLabel="Synthetic rights request kind"
            contentClassName={excluded}
          />
        </div>
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Synthetic rights request kind" }));
    const option = screen.getByRole("option", { name: PRIVATE });
    expect(screen.getByTestId("private-card")).not.toContainElement(option);

    // Exercise the installed capture logic with an included control, not an always-off stub.
    const publicCapture = capture(screen.getByTestId("public-control"));
    expect(publicCapture.explicitNoCapture).not.toBe(true);
    expect(JSON.stringify(publicCapture.props)).toContain(PUBLIC);

    const privateCapture = capture(option);
    expect(privateCapture.explicitNoCapture).toBe(true);
    expect(privateCapture.props).toEqual({});
    expect(JSON.stringify(privateCapture.props)).not.toContain(PRIVATE);
    expect(option.closest(sessionRecordingOptions.blockSelector)).not.toBeNull();
    expect(
      utils.isBlocked(option, "ph-no-capture", sessionRecordingOptions.blockSelector, true),
    ).toBe(true);
  },
);
