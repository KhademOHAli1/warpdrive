// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { testSlackAction } from "./actions";
import { ConnectionOverview } from "./ConnectionOverview";
import { IntegrationHub } from "./IntegrationHub";
import de from "./messages/integrations.de.json";
import en from "./messages/integrations.en.json";
import fa from "./messages/integrations.fa.json";
import { SlackConnection } from "./SlackConnection";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  connectSlackAction: vi.fn(),
  configureSlackAction: vi.fn(),
  disconnectSlackAction: vi.fn(),
  slackChannelsAction: vi.fn(),
  testSlackAction: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const connection = {
  id: "synthetic-connection",
  provider: "slack",
  accountName: "Synthetic workspace",
  status: "connected",
  settings: { channelId: "C001", channelName: "synthetic-channel" },
  lastCheckedAt: null,
};
const locales = [
  {
    locale: "fa",
    messages: fa,
    count: "5 اتصال ثبت شده است.",
    catalog: "اتصال‌های موجود در این نسخه",
    market:
      "بازار افزونه‌ها در برنامهٔ توسعه است. در حال حاضر نمی‌توانید از این بخش افزونه‌ای نصب کنید.",
    checked: "بررسی دسترسی موفق بود",
    removal:
      "دسترسی این اتصال در CRM فوراً قطع می‌شود. لغو مجوز در Slack ممکن است به تلاش دوباره نیاز داشته باشد. قطع این اتصال، اطلاعات CRM یا پیام‌های قبلاً ارسال‌شده را حذف نمی‌کند.",
  },
  {
    locale: "de",
    messages: de,
    count: "5 gespeicherte Verbindungen.",
    catalog: "Integrationen in dieser Version",
    market:
      "Ein App-Marktplatz ist geplant. Hier können derzeit noch keine Apps installiert werden.",
    checked: "Zugriffsprüfung erfolgreich",
    removal:
      "Diese Verbindung wird im CRM sofort gesperrt. Der Widerruf des Slack-Tokens kann einen weiteren Versuch erfordern. Durch das Trennen werden vorhandene CRM-Datensätze und bereits gesendete Nachrichten nicht gelöscht.",
  },
  {
    locale: "en",
    messages: en,
    count: "5 saved connections.",
    catalog: "Integrations in this version",
    market: "An app marketplace is planned. Installing apps here is not available yet.",
    checked: "Access check passed",
    removal:
      "This connection is blocked in the CRM immediately. Revoking the Slack token may need another attempt. Disconnecting does not delete existing CRM records or already sent messages.",
  },
] as const;

it.each(locales)("counts saved rows without claiming they are all active in $locale", (copy) => {
  render(
    <LocaleProvider
      locale={copy.locale}
      calendar="persian"
      numberingSystem="latn"
      timeZone="Europe/Berlin"
    >
      <ConnectionOverview
        services={[
          { ...connection, settings: {} },
          { ...connection, id: "pending", status: "revocation-pending" },
          { ...connection, id: "disconnected", status: "disconnected" },
        ]}
        mailbox={{ status: "error" }}
        aiCount={1}
        onBrowse={() => undefined}
      />
    </LocaleProvider>,
  );
  expect(screen.getByText(copy.count)).toBeVisible();
});

it.each(locales)(
  "labels a successful access check without provider-wide verification in $locale",
  async (copy) => {
    vi.mocked(testSlackAction).mockResolvedValue({ ok: true, value: true });
    render(
      <LocaleProvider
        locale={copy.locale}
        calendar="persian"
        numberingSystem="latn"
        timeZone="Europe/Berlin"
      >
        <SlackConnection connection={connection} isAdmin />
      </LocaleProvider>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: copy.messages.check }));
    expect(screen.getByRole("status")).toHaveTextContent(copy.checked);
  },
);

it.each(locales)(
  "explains immediate local blocking and fallible remote removal in $locale",
  async (copy) => {
    render(
      <LocaleProvider
        locale={copy.locale}
        calendar="persian"
        numberingSystem="latn"
        timeZone="Europe/Berlin"
      >
        <SlackConnection connection={connection} isAdmin />
      </LocaleProvider>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: copy.messages.disconnect }));
    expect(screen.getByText(copy.removal)).toBeVisible();
  },
);

it.each(locales)(
  "separates catalog implementation and planned app installation in $locale",
  async (copy) => {
    render(
      <LocaleProvider
        locale={copy.locale}
        calendar="persian"
        numberingSystem="latn"
        timeZone="Europe/Berlin"
      >
        <IntegrationHub
          endpoint={null}
          slackConfigured={false}
          isAdmin={false}
          serviceConnections={[]}
          aiConnections={[]}
          gmail={<p>Synthetic mailbox controls</p>}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("heading", { name: copy.catalog })).toBeVisible();
    await userEvent.setup().click(screen.getByRole("tab", { name: copy.messages.marketplace }));
    expect(screen.getByText(copy.market)).toBeVisible();
  },
);
