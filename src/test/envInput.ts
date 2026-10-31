import { env } from "@/config/env";

// Boundary tests start with the validated Vitest environment rather than adding
// another direct process.env reader outside the application's configuration module.
export function testEnvInput(): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(env).map(
        ([key, value]) =>
          [
            key,
            value === undefined
              ? undefined
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value),
          ] as const,
      ),
    ),
    NODE_ENV: env.NODE_ENV,
  };
}
