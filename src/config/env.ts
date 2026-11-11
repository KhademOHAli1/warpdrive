import { readFileSync } from "node:fs";
import { z } from "zod";
import { billingEnvShape, parseBillingConfig } from "@/features/billing/config";
import { StripeGateway } from "@/features/billing/stripe/gateway";
import { err, ok, type Result } from "@/types/result";
import { authEnvShape } from "./authEnv";
import { mailEnvShape } from "./mailEnv";

// Secret vars may be supplied as <VAR>_FILE pointing at a Docker secret file.
const SECRET_FILE_VARS = [
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "SLACK_CLIENT_SECRET",
  "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET",
  "WS_TICKET_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "MINIO_SECRET_KEY",
  "DATABASE_URL",
  "OAUTH_SIGNING_KEY",
  "AUTH_SECRET",
  "AUTH_SMTP_PASSWORD",
  "NEWSLETTER_API_TOKEN",
  "AUTH_MICROSOFT_CLIENT_SECRET",
  "AUTH_OIDC_PROVIDERS",
  "MAIL_INTERNAL_ENDPOINTS",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "WORKFLOW_HTTP_GRANTS",
  "WORKFLOW_WEBHOOK_KEYS",
] as const;

function resolveFileVars(
  raw: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...raw };
  for (const name of SECRET_FILE_VARS) {
    const filePath = raw[`${name}_FILE`];
    if (filePath != null && filePath.length > 0) {
      out[name] = readFileSync(filePath, "utf8").trim();
    }
  }
  return out;
}

const boolFromString = z.enum(["true", "false"]).transform((v) => v === "true");

const base = z.object({
  ...authEnvShape,
  ...mailEnvShape,
  ...billingEnvShape,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WORKFLOW_HTTP_GRANTS: z.string().default(""),
  WORKFLOW_WEBHOOK_KEYS: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(""),
  SLACK_CLIENT_ID: z.string().trim().default(""),
  SLACK_CLIENT_SECRET: z.string().trim().default(""),
  GOOGLE_CALENDAR_OAUTH_CLIENT_ID: z.string().trim().max(1024).default(""),
  GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: z.string().trim().max(4096).default(""),
  GOOGLE_CALENDAR_ACCESS: z.enum(["readOnly", "readWrite"]).default("readWrite"),
  GOOGLE_WORKSPACE_DOMAIN: z.string().default(""),
  BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  WS_TICKET_SECRET: z.string().min(32),
  WS_PUBLIC_URL: z.string().min(1),
  // Leave unset for the existing all-interface container listener; set explicitly for local use.
  WS_HOST: z.string().trim().min(1).optional(),
  // Full URL, not a bare hostname: buildMinioClient does new URL(MINIO_ENDPOINT), and the
  // browser POSTs uploads directly to the presigned host, so it must be publicly reachable
  // (e.g. https://s3.example.com), never an internal-only compose alias like "minio".
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1).default("warpdrive"),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(26_214_400),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be base64 of exactly 32 bytes"),
  MCP_ENABLED: boolFromString.default(true),
  OAUTH_SIGNING_KEY: z.string().default(""),
  // RFC 7591 dynamic client registration. Open by default because it is what lets an MCP client
  // self-onboard with no admin step, and closing it by default would break every existing deploy
  // on upgrade. It is a knob because an open endpoint lets any stranger mint a client whose name
  // the consent screen then shows to a user, which is the setup for consent phishing: a deploy
  // that has already connected the clients it needs can set "disabled" and shut the door. An
  // enum rather than a boolean so a typo fails at boot instead of silently reading as "open".
  OAUTH_REGISTRATION: z.enum(["open", "disabled"]).default("open"),
  // Opt-in while lifecycle, access-revocation and upgrade acceptance remain under qualification.
  SALES_PIPELINE_LIFECYCLE_ENABLED: boolFromString.default(false),
  // Queue query, action-admission and UI acceptance are qualified before exposure.
  SALES_NEXT_ACTION_QUEUE_ENABLED: boolFromString.default(false),
  // One private Listmonk engine per installation. The browser never receives these values.
  NEWSLETTER_BASE_URL: z.string().trim().default(""),
  NEWSLETTER_API_USER: z.string().trim().default(""),
  NEWSLETTER_API_TOKEN: z.string().default(""),
  NEWSLETTER_DELIVERY_ENABLED: boolFromString.default(false),
  NEWSLETTER_PUBLIC_SIGNUP_ENABLED: boolFromString.default(false),
  NEWSLETTER_PUBLIC_ORIGIN: z
    .string()
    .trim()
    .default("")
    .refine((value) => {
      if (value === "") return true;
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === ""
      );
    }, "Set the exact HTTPS origin of the public newsletter.")
    .transform((value) => (value === "" ? value : new URL(value).origin)),
  NEWSLETTER_TEST_RECIPIENTS: z
    .string()
    .max(4096)
    .default("")
    .transform((value) =>
      [...new Set(value.split(",").map((email) => email.trim().toLowerCase()))].filter(
        (email) => email !== "",
      ),
    )
    .pipe(z.array(z.email().max(254)).max(50)),
  BASE_CURRENCY: z.string().length(3).default("USD"),
  SEED_ADMIN_EMAIL: z.string().email().or(z.literal("")).default(""),
  ALLOW_FIRST_LOGIN_ADMIN: boolFromString.default(false),
  // Optional build-time stamp of the running version (e.g. a release tag). Empty when unstamped;
  // the release feature then falls back to package.json, then "dev". See resolveVersion.
  APP_VERSION: z.string().default(""),
  // Client PostHog config is passed to the browser via the server layout (props), not
  // NEXT_PUBLIC vars, so this stays the single env boundary. Empty key disables telemetry.
  POSTHOG_KEY: z.string().default(""),
  POSTHOG_HOST: z.string().default(""),
  DISABLE_TELEMETRY: boolFromString.default(false),
  // Console.warn/error forwarding is off by default (widens the event surface); opt in per deploy.
  TELEMETRY_CONSOLE_FORWARDING: boolFromString.default(false),
  // Git SHA of the running build, for regression attribution alongside APP_VERSION.
  APP_COMMIT: z.string().default(""),
  // Kill switch for the GitHub update-check banner. A hosted/managed deployment sets this true;
  // OSS self-hosters leave it false to get the banner.
  DISABLE_UPDATE_CHECK: boolFromString.default(false),
});

function validateBillingEnvironment(v: ReturnType<typeof base.parse>, ctx: z.RefinementCtx): void {
  try {
    const billing = parseBillingConfig(v, v.BASE_URL);
    if (billing !== null) new StripeGateway({ ...billing, signal: new AbortController().signal });
  } catch {
    ctx.addIssue({
      code: "custom",
      path: ["BILLING_ENABLED"],
      message:
        "Enabled billing requires valid merchant hosting, Stripe mode, prices, portal, included seats and secrets",
    });
  }
}

function calendarOAuthCredentialsPaired(value: {
  GOOGLE_CALENDAR_OAUTH_CLIENT_ID: string;
  GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: string;
}): boolean {
  return (
    (value.GOOGLE_CALENDAR_OAUTH_CLIENT_ID === "") ===
    (value.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET === "")
  );
}

function validateNewsletterEnvironment(
  v: ReturnType<typeof base.parse>,
  ctx: z.RefinementCtx,
): void {
  const newsletterValues = [v.NEWSLETTER_BASE_URL, v.NEWSLETTER_API_USER, v.NEWSLETTER_API_TOKEN];
  const newsletterConfigured = newsletterValues.some((value) => value !== "");
  if (newsletterConfigured || v.NEWSLETTER_DELIVERY_ENABLED) {
    const endpoint = URL.canParse(v.NEWSLETTER_BASE_URL) ? new URL(v.NEWSLETTER_BASE_URL) : null;
    const privateHttp =
      endpoint?.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]", "newsletter-engine"].includes(endpoint.hostname);
    if (
      endpoint === null ||
      !(endpoint.protocol === "https:" || privateHttp) ||
      endpoint.username !== "" ||
      endpoint.password !== "" ||
      endpoint.pathname !== "/" ||
      endpoint.search !== "" ||
      endpoint.hash !== "" ||
      !/^[a-zA-Z0-9_.@-]{3,160}$/.test(v.NEWSLETTER_API_USER) ||
      v.NEWSLETTER_API_TOKEN.length < 16 ||
      v.NEWSLETTER_API_TOKEN.length > 1024 ||
      /[\s:]/.test(v.NEWSLETTER_API_TOKEN)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["NEWSLETTER_BASE_URL"],
        message:
          "Campaign integration requires an engine origin and a dedicated API user and token",
      });
    }
  }
}

// Production guardrails for the first-run bootstrap (ops spec E6).
const schema = base.superRefine((v, ctx) => {
  if (!calendarOAuthCredentialsPaired(v)) {
    ctx.addIssue({
      code: "custom",
      path: ["GOOGLE_CALENDAR_OAUTH_CLIENT_ID"],
      message: "Calendar OAuth client ID and secret must both be configured or both unset",
    });
  }
  validateBillingEnvironment(v, ctx);
  validateNewsletterEnvironment(v, ctx);
  if (v.MCP_ENABLED && Buffer.from(v.OAUTH_SIGNING_KEY, "base64").length !== 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OAUTH_SIGNING_KEY"],
      message: "OAUTH_SIGNING_KEY (base64 32 bytes) is required when MCP_ENABLED",
    });
  }
  if (v.NODE_ENV === "production") {
    if (!URL.canParse(v.BASE_URL) || new URL(v.BASE_URL).protocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        path: ["BASE_URL"],
        message: "production authentication requires an HTTPS BASE_URL",
      });
    }
    if (v.AUTH_SECRET.length < 32) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message: "AUTH_SECRET of at least 32 high-entropy characters is required in production",
      });
    }
    if (v.AUTH_MAIL_TRANSPORT !== "smtp" || v.AUTH_SMTP_HOST === "") {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MAIL_TRANSPORT"],
        message: "production authentication requires configured SMTP delivery",
      });
    }
    if (v.ALLOW_FIRST_LOGIN_ADMIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ALLOW_FIRST_LOGIN_ADMIN"],
        message: "ALLOW_FIRST_LOGIN_ADMIN must be false in production",
      });
    }
    if (v.SEED_ADMIN_EMAIL === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SEED_ADMIN_EMAIL"],
        message: "SEED_ADMIN_EMAIL is required in production",
      });
    }
  }
});

// Named export of the full validated schema (with production guardrails) so
// boundary tests can parse a candidate env map directly.
export const envSchema = schema;

export type Env = z.infer<typeof base>;

// Pure, testable: validates a given source map without touching the global env.
export function parseEnv(raw: Record<string, string | undefined>): Result<Env, string> {
  const resolved = resolveFileVars(raw);
  const parsed = schema.safeParse(resolved);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return ok(parsed.data);
}

function loadOrThrow(): Env {
  const result = parseEnv(process.env);
  if (!result.ok) {
    // Fail fast at import time so misconfiguration is a boot error, not a first-use error.
    throw new Error(`Invalid environment: ${result.error}`);
  }
  return result.value;
}

export const env: Env = loadOrThrow();
