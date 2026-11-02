// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { ShieldCheck } from "lucide-react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SecurityStatus } from "../better/contracts";
import {
  expectPrivateReplay,
  PRIVATE_CODES,
  PRIVATE_OTP,
  PRIVATE_QR,
  PRIVATE_SEED,
  securityStatus,
  showSecurity,
} from "./__fixtures__/SecurityReplayPrivacyTestKit";
import { FreshVerification } from "./FreshVerification";
import { RecoveryCodes } from "./RecoveryCodes";
import { SecuritySettings } from "./SecuritySettings";
import { SecurityAction } from "./SecuritySurface";

const mocks = vi.hoisted(() => ({ enable: vi.fn(), verifyTotp: vi.fn(), qr: vi.fn() }));
vi.mock("../better/client", () => ({
  authClient: { twoFactor: { enable: mocks.enable, verifyTotp: mocks.verifyTotp } },
}));
vi.mock("qrcode", () => ({ default: { toDataURL: mocks.qr } }));
vi.mock("./useAccountStatus", () => ({
  useAccountStatus: (status: SecurityStatus) => ({ status, error: null, refresh: vi.fn() }),
  useAuthProviders: () => ({ config: { providers: [], emailPassword: true, passkeys: false } }),
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/settings/security",
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enable.mockResolvedValue({
    data: { totpURI: `otpauth://totp/Test?secret=${PRIVATE_SEED}`, backupCodes: PRIVATE_CODES },
    error: null,
  });
  mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
  mocks.qr.mockResolvedValue(PRIVATE_QR);
});
afterEach(cleanup);

async function enrollThroughSettings() {
  showSecurity(<SecuritySettings initial={securityStatus} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage" }));
  const dialog = screen.getByRole("dialog", { name: "Two-step verification" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Set up authenticator" }));
  await within(dialog).findByText(PRIVATE_SEED);
  const qr = await within(dialog).findByRole("img", {
    name: "QR code for your authenticator setup",
  });
  expect(qr).toHaveAttribute("src", PRIVATE_QR);
  expect(mocks.enable).toHaveBeenCalledOnce();
  return dialog;
}

test.each([false, true])(
  "SecurityPanel excludes ordinary TOTP input (embedded: %s)",
  (embedded) => {
    showSecurity(
      <FreshVerification
        status={{ ...securityStatus, fresh: false, twoFactorEnabled: true }}
        refresh={vi.fn()}
        embedded={embedded}
      />,
    );
    const input = screen.getByLabelText("Authenticator code");
    fireEvent.change(input, { target: { value: PRIVATE_OTP } });
    expect(input).toHaveValue(PRIVATE_OTP);
    expectPrivateReplay(input, [PRIVATE_OTP]);
  },
);

test("the real settings enrollment portal excludes the rendered seed, QR source and TOTP", async () => {
  const dialog = await enrollThroughSettings();
  const input = within(dialog).getByLabelText("Authenticator code");
  fireEvent.change(input, { target: { value: PRIVATE_OTP } });
  expect(input).toHaveValue(PRIVATE_OTP);
  expectPrivateReplay(input, [PRIVATE_SEED, PRIVATE_QR, PRIVATE_OTP]);
});

test("the real enrollment flow excludes the displayed recovery codes after verification", async () => {
  const dialog = await enrollThroughSettings();
  fireEvent.change(within(dialog).getByLabelText("Authenticator code"), {
    target: { value: "012345" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Verify code" }));
  const code = await within(dialog).findByText(PRIVATE_CODES[0]);
  expect(within(dialog).getByText(PRIVATE_CODES[1])).toBeInTheDocument();
  expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: "012345" });
  expectPrivateReplay(code, PRIVATE_CODES);
});

test("SecurityAction protects real recovery-code children at its arbitrary-children portal boundary", () => {
  showSecurity(
    <SecurityAction
      icon={ShieldCheck}
      title="Synthetic security action"
      description="Test flow"
      action="Open security action"
    >
      <RecoveryCodes codes={PRIVATE_CODES} onContinue={vi.fn()} />
    </SecurityAction>,
  );
  const trigger = screen.getByRole("button", { name: "Open security action" });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Synthetic security action" });
  const code = within(dialog).getByText(PRIVATE_CODES[0]);
  expect(within(dialog).getByText(PRIVATE_CODES[1])).toBeInTheDocument();
  expect(trigger.parentElement).not.toContainElement(code);
  expectPrivateReplay(code, PRIVATE_CODES);
});

test("the SecurityAction row excludes personal description before its portal opens", () => {
  const description = "PRIVATE-Security-action-description";
  showSecurity(
    <SecurityAction
      icon={ShieldCheck}
      title="Security row"
      description={description}
      action="Open security action"
    >
      <p>Unused child</p>
    </SecurityAction>,
  );
  expectPrivateReplay(screen.getByText(description), [description]);
});

test("the full SecuritySettings root excludes the displayed identity", () => {
  showSecurity(<SecuritySettings initial={securityStatus} />);
  const user = screen.getByText(securityStatus.user.name);
  expect(screen.getByText(securityStatus.user.email)).toBeInTheDocument();
  expectPrivateReplay(user, [securityStatus.user.name, securityStatus.user.email]);
});

test("the independent activity portal excludes its rendered fourth event metadata", () => {
  const fourthTime = "2044-04-04T04:04:04Z";
  const audit = [
    "2041-01-01T01:01:01Z",
    "2042-02-02T02:02:02Z",
    "2043-03-03T03:03:03Z",
    fourthTime,
  ].map((createdAt, index) => ({
    id: `event-${index}`,
    action: "sign-in",
    outcome: "success",
    createdAt,
  }));
  showSecurity(<SecuritySettings initial={{ ...securityStatus, audit }} />);
  fireEvent.click(screen.getByRole("button", { name: "View all activity" }));
  const dialog = screen.getByRole("dialog", { name: "Recent security activity" });
  const time = within(dialog)
    .getAllByRole("time")
    .find((item) => item.getAttribute("dateTime") === fourthTime);
  expect(time).toBeInTheDocument();
  expectPrivateReplay(dialog, [fourthTime]);
});
