// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { IntegrationHub } from "@/features/integrations/IntegrationHub";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/integrations/actions", () => ({
  connectSlackAction: vi.fn(),
  configureSlackAction: vi.fn(),
  disconnectSlackAction: vi.fn(),
  slackChannelsAction: vi.fn(),
  testSlackAction: vi.fn(),
}));
vi.mock("@/app/(app)/settings/connections/ConnectionsClient", () => ({
  ConnectionsClient: () => <p>Authorized clients</p>,
}));
afterEach(cleanup);

const languages = [
  { locale: "en", name: "Email accounts" },
  { locale: "fa", name: "صندوق‌های ایمیل" },
  { locale: "de", name: "E-Mail-Postfächer" },
] as const;

it.each(
  languages.flatMap((language) => ["browse", "connections"].map((tab) => ({ ...language, tab }))),
)(
  "exposes personal mailbox setup in $locale on $tab without AI or Google",
  ({ locale, name, tab }) => {
    render(
      <LocaleProvider locale={locale}>
        <IntegrationHub
          endpoint={null}
          slackConfigured={false}
          isAdmin={false}
          serviceConnections={[]}
          aiConnections={[]}
          gmail={<p>Gmail account controls</p>}
          gmailConfigured={false}
          initialTab={tab}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("link", { name })).toBeVisible();
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", "/settings/email-sync");
  },
);
