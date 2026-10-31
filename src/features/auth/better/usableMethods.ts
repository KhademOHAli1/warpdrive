import type { AuthContext } from "@better-auth/core";

export type AuthMethodContext = Pick<AuthContext, "options" | "socialProviders">;

// Use the initialized native registry, including verified OIDC discovery, rather than stored
// account rows or a second interpretation of environment flags. Disabled methods cannot rescue
// a user after their final working credential is removed.
export function usableAuthenticationMethods(
  context: AuthMethodContext,
  accounts: readonly { providerId: string; password: string | null }[],
  storedPasskeys: number,
) {
  return {
    hasAccount: accounts.some((account) =>
      account.providerId === "credential"
        ? context.options.emailAndPassword?.enabled === true &&
          account.password !== null &&
          account.password.length > 0
        : context.socialProviders.some((provider) => provider.id === account.providerId),
    ),
    passkeys:
      context.options.plugins?.some((plugin) => plugin.id === "passkey") === true
        ? storedPasskeys
        : 0,
  };
}
