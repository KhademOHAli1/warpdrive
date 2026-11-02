import type { deals, emailAccounts, integrationConnections, users } from "@/db/schema";
import type { LocalePreferences } from "@/features/i18n/preferences";

export const integrationFixturePreferences = {
  admin: { locale: "fa", calendar: "gregory", numberingSystem: "latn", timeZone: "Europe/Berlin" },
  member: {
    locale: "de",
    calendar: "persian",
    numberingSystem: "arabext",
    timeZone: "Asia/Tehran",
  },
  outsider: {
    locale: "en",
    calendar: "gregory",
    numberingSystem: "arabext",
    timeZone: "Asia/Tehran",
  },
} as const satisfies Record<string, LocalePreferences>;

export const integrationFixtureBoundaries = {
  nowruz: {
    gregorian: "2026-03-21",
    persian: "1405-01-01",
    tehranAnchor: "2026-03-20T20:30:00.000Z",
    inclusiveEnd: "2026-03-22",
    endAnchor: "2026-03-21T20:30:00.000Z",
  },
  berlinFold: {
    date: "2026-10-25",
    time: "02:30",
    earlier: "2026-10-25T00:30:00.000Z",
    later: "2026-10-25T01:30:00.000Z",
  },
  berlinGap: {
    date: "2026-03-29",
    invalidTime: "02:30",
    before: "2026-03-29T00:59:00.000Z",
    after: "2026-03-29T01:00:00.000Z",
  },
} as const;

type User = typeof users.$inferSelect;
type Deal = typeof deals.$inferSelect;
type Connection = Pick<
  typeof integrationConnections.$inferSelect,
  "id" | "accountId" | "ownerId" | "status"
>;
type Mailbox = Pick<typeof emailAccounts.$inferSelect, "id" | "userId" | "emailAddress">;

export interface IntegrationFixtureGrant {
  clientId: string;
  userId: string;
  accessJti: string;
  // Access fixtures are row identities, not signed bearer JWTs. Refresh values are synthetic only.
  refreshToken: string;
  refreshTokenHash: string;
  codeHash: string;
}

export interface IntegrationFixtureCore {
  users: { admin: User; member: User; outsider: User; inactive: User };
  deals: { visible: Deal; hidden: Deal; restricted: Deal };
  restrictedGroupId: string;
  activities: { tehranDateOnly: string; berlinFoldEarlier: string; berlinFoldLater: string };
  preferences: typeof integrationFixturePreferences;
  boundaries: typeof integrationFixtureBoundaries;
}

export interface IntegrationPlatformFixtures extends IntegrationFixtureCore {
  namespace: string;
  now: Date;
  connections: { first: Connection; second: Connection };
  mailboxes: { member: Mailbox; outsider: Mailbox };
  grants: Record<"valid" | "expired" | "revoked" | "inactiveOwner", IntegrationFixtureGrant>;
  sessions: { member: { id: string; token: string }; adminPending: { id: string; token: string } };
  limits: {
    oauthCapabilities: "not-persisted-in-current-model";
    personalMailboxesSeededPerUser: 1;
    serviceConnections: "shared-admin-managed";
    evidence: "synthetic-real-postgresql-only";
    authentication: "synthetic-native-model-not-browser-enrollment";
  };
}

export type IntegrationFixtureError = {
  code:
    | "invalid_input"
    | "disposable_database_required"
    | "write_failed"
    | "commit_outcome_unknown"
    | "committed_cleanup_failed";
};
