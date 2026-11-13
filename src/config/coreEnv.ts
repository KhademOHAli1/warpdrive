import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

const milliseconds = (minimum: number, maximum: number, fallback: number) =>
  z.coerce.number().int().min(minimum).max(maximum).default(fallback);

/** Optional process profile. Existing services retain their current connection settings. */
export const coreEnvShape = {
  RUNTIME_COMPONENT: z.enum(["web", "core-api", "worker", "realtime", "migrator"]).default("web"),
  CORE_HOST: z.string().trim().min(1).max(253).default("0.0.0.0"),
  CORE_PORT: z.coerce.number().int().min(1).max(65535).default(3010),
  CORE_DB_MAX: z.coerce.number().int().min(4).max(16).default(8),
  CORE_PRODUCER_DB_MAX: z.coerce.number().int().min(1).max(4).default(2),
  CORE_DB_CONNECT_MS: milliseconds(250, 5_000, 2_000),
  CORE_DB_STATEMENT_MS: milliseconds(5_000, 120_000, 30_000),
  CORE_DB_QUERY_MS: milliseconds(6_000, 125_000, 35_000),
  CORE_DB_LOCK_MS: milliseconds(100, 5_000, 2_000),
  // Must name the accepted Web ingress, so a UI swap does not require restarting Core.
  CORE_WEB_ORIGIN: z.string().trim().max(2048).default(""),
};

export type CoreEnvironment = z.infer<z.ZodObject<typeof coreEnvShape>> & {
  MIGRATION_DATABASE_URL: string;
};

/** Inactive optional settings must not change legacy environment admission. */
export function prepareCoreEnvironment(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = { ...raw };
  if ("RUNTIME_COMPONENT" in value && value.RUNTIME_COMPONENT === "core-api") return value;
  for (const key of Object.keys(coreEnvShape))
    if (key !== "RUNTIME_COMPONENT") Reflect.deleteProperty(value, key);
  return value;
}

function validOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  );
}

export function validateCoreEnvironment(value: CoreEnvironment, ctx: z.RefinementCtx): void {
  if (value.RUNTIME_COMPONENT !== "core-api") return;
  const issues: [string, boolean][] = [
    ["CORE_HOST", !/[\s\0/]/u.test(value.CORE_HOST)],
    ["CORE_DB_QUERY_MS", value.CORE_DB_QUERY_MS >= value.CORE_DB_STATEMENT_MS + 1_000],
    ["CORE_DB_LOCK_MS", value.CORE_DB_LOCK_MS < value.CORE_DB_STATEMENT_MS],
    ["CORE_WEB_ORIGIN", validOrigin(value.CORE_WEB_ORIGIN)],
    ["MIGRATION_DATABASE_URL", value.MIGRATION_DATABASE_URL === ""],
  ];
  for (const [path, valid] of issues)
    if (!valid)
      ctx.addIssue({ code: "custom", path: [path], message: "Invalid Core runtime profile" });
}

/** A Core entrypoint may never silently boot with the legacy Web pool profile. */
export function requireCoreProfile(value: CoreEnvironment): void {
  if (value.RUNTIME_COMPONENT !== "core-api")
    throw new AppError(ERROR_IDS.RUNTIME_CORE_API_CONFIGURATION_INVALID, "Core profile required");
}
