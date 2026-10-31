import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const REQUIRED = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_WORKSPACE_DOMAIN",
  "BASE_URL",
  "DATABASE_URL",
  "WS_TICKET_SECRET",
  "WS_PUBLIC_URL",
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_BUCKET",
  "MAX_FILE_BYTES",
  "TOKEN_ENCRYPTION_KEY",
  "BASE_CURRENCY",
  "SEED_ADMIN_EMAIL",
  "ALLOW_FIRST_LOGIN_ADMIN",
  "AUTH_SECRET",
  "AUTH_ALLOW_PASSWORD",
  "AUTH_ALLOW_PASSKEY",
  "AUTH_GOOGLE_ENABLED",
  "AUTH_MICROSOFT_CLIENT_ID",
  "AUTH_MICROSOFT_CLIENT_SECRET",
  "AUTH_MICROSOFT_TENANT",
  "AUTH_OIDC_PROVIDERS",
  "AUTH_TRUSTED_PROXY_HEADER",
  "AUTH_MAIL_TRANSPORT",
  "AUTH_MAIL_FROM",
  "AUTH_SMTP_HOST",
  "AUTH_SMTP_PORT",
  "AUTH_SMTP_SECURE",
  "AUTH_SMTP_USER",
  "AUTH_SMTP_PASSWORD",
];

describe(".env.example", () => {
  const text = readFileSync(".env.example", "utf8");
  test("lists every required key", () => {
    for (const key of REQUIRED) expect(text, `missing ${key}`).toContain(`${key}=`);
  });
  test("contains no real secret values (keys are empty or placeholder)", () => {
    const secretLine = text.split("\n").find((l) => l.startsWith("TOKEN_ENCRYPTION_KEY="));
    expect(secretLine).toBe("TOKEN_ENCRYPTION_KEY=");
  });
});
