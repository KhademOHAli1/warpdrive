import { expect, it } from "vitest";
import { env } from "@/config/env";
import { calendarDeploymentConfig } from "./authorizationDeployment";

it("never falls back to the configured Gmail/login OAuth app", () => {
  expect(
    calendarDeploymentConfig({
      ...env,
      GOOGLE_CALENDAR_OAUTH_CLIENT_ID: "",
      GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "",
    }),
  ).toBeNull();
});
it("derives the fixed callback from trusted BASE_URL with the dedicated app and access mode", () => {
  expect(
    calendarDeploymentConfig({
      ...env,
      BASE_URL: "http://localhost:3010/",
      GOOGLE_CALENDAR_OAUTH_CLIENT_ID: "calendar-id",
      GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "calendar-secret",
      GOOGLE_CALENDAR_ACCESS: "readOnly",
    }),
  ).toEqual({
    clientId: "calendar-id",
    clientSecret: "calendar-secret",
    redirectUri: "http://localhost:3010/api/calendar/google/oauth/callback",
    access: "readOnly",
  });
});
