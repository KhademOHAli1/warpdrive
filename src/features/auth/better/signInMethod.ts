/** Preserve the primary login choice while a second factor completes its session. */
export function sessionSignInMethod(path: string, provider: unknown, previous: unknown): string {
  if (path === "/sign-in/email") return "password";
  if (path === "/passkey/verify-authentication") return "passkey";
  if (path.startsWith("/two-factor/verify-")) {
    return typeof previous === "string" && previous !== "pending" ? previous : "password";
  }
  const lastSegment = path.split("/").at(-1);
  return typeof provider === "string"
    ? provider
    : lastSegment !== undefined && lastSegment.length > 0
      ? lastSegment
      : "password";
}
