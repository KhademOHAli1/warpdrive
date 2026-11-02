import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseEnv } from "./env";

const base = {
  NODE_ENV: "test" as const,
  BASE_URL: "https://calendar.example.invalid",
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  WS_TICKET_SECRET: "test-calendar-ws-secret-over-thirty-two-characters",
  WS_PUBLIC_URL: "wss://calendar.example.invalid/ws",
  MINIO_ENDPOINT: "http://localhost:9000",
  MINIO_ACCESS_KEY: "test-access",
  MINIO_SECRET_KEY: "test-secret",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  MCP_ENABLED: "false",
  GOOGLE_OAUTH_CLIENT_ID: "existing-gmail-app",
  GOOGLE_OAUTH_CLIENT_SECRET: "existing-gmail-secret",
};
it("leaves the dedicated Calendar app unconfigured independently from Gmail", () => {
  const parsed = parseEnv({
    ...base,
    GOOGLE_CALENDAR_OAUTH_CLIENT_ID: "",
    GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "",
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toMatchObject({
    GOOGLE_CALENDAR_OAUTH_CLIENT_ID: "",
    GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "",
    GOOGLE_CALENDAR_ACCESS: "readWrite",
  });
});
it.each([
  { GOOGLE_CALENDAR_OAUTH_CLIENT_ID: "dedicated", GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "" },
  { GOOGLE_CALENDAR_OAUTH_CLIENT_ID: "", GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "secret" },
  {
    GOOGLE_CALENDAR_OAUTH_CLIENT_ID: "dedicated",
    GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "secret",
    GOOGLE_CALENDAR_ACCESS: "typo",
  },
])("rejects partial or malformed dedicated Calendar configuration %j", (extra) => {
  expect(parseEnv({ ...base, ...extra }).ok).toBe(false);
});
it("loads the dedicated Calendar secret from its own Docker secret file", () => {
  const directory = mkdtempSync(join(tmpdir(), "calendar-config-"));
  try {
    const secretFile = join(directory, "calendar_secret");
    writeFileSync(secretFile, "calendar-file-secret\n");
    const parsed = parseEnv({
      ...base,
      GOOGLE_CALENDAR_OAUTH_CLIENT_ID: "dedicated-calendar",
      GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "ignored",
      GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET_FILE: secretFile,
      GOOGLE_CALENDAR_ACCESS: "readOnly",
    });
    expect(parsed.ok && parsed.value).toMatchObject({
      GOOGLE_CALENDAR_OAUTH_CLIENT_ID: "dedicated-calendar",
      GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "calendar-file-secret",
      GOOGLE_CALENDAR_ACCESS: "readOnly",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
