import { z } from "zod";

const oidcProvider = z.object({
  name: z.string().trim().min(1).max(80),
  issuer: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  }, "OIDC issuer must be an HTTPS origin/path without credentials, query or fragment"),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

const configuredProviders = z
  .string()
  .default("[]")
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "must be a JSON array of configured OIDC providers",
      });
      return z.NEVER;
    }
  })
  .pipe(z.array(oidcProvider).max(10));

const bool = z.enum(["true", "false"]).transform((value) => value === "true");

export const authEnvShape = {
  AUTH_SECRET: z.string().default(""),
  AUTH_TRUSTED_PROXY_HEADER: z
    .enum(["none", "x-forwarded-for", "x-real-ip", "cf-connecting-ip"])
    .default("none"),
  AUTH_ALLOW_PASSWORD: bool.default(true),
  AUTH_ALLOW_PASSKEY: bool.default(true),
  AUTH_GOOGLE_ENABLED: bool.default(true),
  AUTH_MICROSOFT_CLIENT_ID: z.string().default(""),
  AUTH_MICROSOFT_CLIENT_SECRET: z.string().default(""),
  AUTH_MICROSOFT_TENANT: z
    .string()
    .regex(/^[a-zA-Z0-9.-]+$/)
    .default("organizations"),
  AUTH_OIDC_PROVIDERS: configuredProviders,
  AUTH_MAIL_TRANSPORT: z.enum(["capture", "smtp"]).default("capture"),
  AUTH_MAIL_FROM: z.email().default("noreply@example.com"),
  AUTH_SMTP_HOST: z.string().default(""),
  AUTH_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  AUTH_SMTP_SECURE: bool.default(false),
  AUTH_SMTP_USER: z.string().default(""),
  AUTH_SMTP_PASSWORD: z.string().default(""),
};
