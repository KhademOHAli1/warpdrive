import { render, screen } from "@testing-library/react";
import { autocapturePropertiesForElement } from "posthog-js/lib/src/autocapture";
import { EventType, record, takeFullSnapshot } from "posthog-js/rrweb";
import type { ReactNode } from "react";
import { expect } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { sessionRecordingOptions } from "@/features/observability/replayMasking";
import type { SecurityStatus } from "../../better/contracts";

export const PRIVATE_SEED = "PRIVATE-TOTP-seed";
export const PRIVATE_CODES: [string, string] = ["PRIVATE-backup-code-1", "PRIVATE-backup-code-2"];
export const PRIVATE_QR = "data:image/png;base64,UFJJVkFURS1RUi1zb3VyY2U=";
export const PRIVATE_OTP = "PRIVATE-TOTP-012345";
const PUBLIC = "PUBLIC-Security-replay-control";
export const securityStatus: SecurityStatus = {
  authenticated: true,
  user: { id: "u", name: "PRIVATE-Security-user", email: "PRIVATE@example.test", isAdmin: false },
  emailVerified: true,
  hasPassword: false,
  twoFactorEnabled: false,
  needsMfa: false,
  needsEnrollment: false,
  fresh: true,
  authMethod: "password",
  policy: { requireMfaForAll: false, idleMinutes: 30, absoluteHours: 12, freshMinutes: 5 },
  accounts: [],
  passkeys: [],
  sessions: [],
  recoveryCodesAvailable: false,
  audit: [],
};

export function showSecurity(children: ReactNode) {
  return render(
    <>
      <button type="button" data-testid="public-security-control">
        {PUBLIC}
      </button>
      <LocaleProvider locale="en" timeZone="UTC">
        {children}
      </LocaleProvider>
    </>,
  );
}

function capture(element: Element) {
  return autocapturePropertiesForElement(element, {
    e: new MouseEvent("click", { bubbles: true }),
    maskAllElementAttributes: false,
    maskAllText: false,
    elementsChainAsString: false,
    disableCaptureUrlHashes: false,
  });
}

export function expectPrivateReplay(element: Element, sentinels: string[]) {
  const snapshots: string[] = [];
  const stop = record({
    ...sessionRecordingOptions,
    blockClass: "ph-no-capture",
    emit(event) {
      if (event.type === EventType.FullSnapshot) snapshots.push(JSON.stringify(event));
    },
  });
  try {
    expect(stop).toBeTypeOf("function");
    const before = snapshots.length;
    takeFullSnapshot();
    expect(snapshots.length).toBeGreaterThan(before);
    const snapshot = snapshots.at(-1);
    expect(snapshot).toContain(PUBLIC);
    for (const sentinel of sentinels) expect(snapshot).not.toContain(sentinel);
    const publicCapture = capture(screen.getByTestId("public-security-control"));
    expect(publicCapture.explicitNoCapture).not.toBe(true);
    expect(JSON.stringify(publicCapture.props)).toContain(PUBLIC);
    const privateCapture = capture(element);
    expect(privateCapture.explicitNoCapture).toBe(true);
    expect(privateCapture.props).toEqual({});
    expect(
      element.closest(`${sessionRecordingOptions.blockSelector}.ph-no-capture`),
    ).not.toBeNull();
  } finally {
    stop?.();
  }
}
