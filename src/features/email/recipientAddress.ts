// Pure mail-only UX/server check. It never rewrites, transliterates or changes case.
const DOMAIN =
  /^[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?)+$/u;
const FORBIDDEN = /[\s\p{Cc}<>()[\]\\,;:"\uD800-\uDFFF]/u;
const FORMAT = /\p{Cf}/u;
const encoder = new TextEncoder();
const MAX_ADDRESS_BYTES = 254;
const MAX_LOCAL_BYTES = 64;
const MAX_DOMAIN_ASCII = 253;
const MAX_LABEL_ASCII = 63;

export function isValidMailRecipient(value: string): boolean {
  if (value.length === 0 || value.length > MAX_ADDRESS_BYTES || FORBIDDEN.test(value)) return false;
  if (encoder.encode(value).length > MAX_ADDRESS_BYTES) return false;
  for (const character of value) {
    // Persian joining characters are valid authored mailbox text; direction overrides are not.
    if (FORMAT.test(character) && character !== "\u200c" && character !== "\u200d") return false;
  }
  const parts = value.split("@");
  const [local, domain] = parts;
  if (parts.length !== 2 || local === undefined || domain === undefined) return false;
  if (local.length === 0 || encoder.encode(local).length > MAX_LOCAL_BYTES) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!DOMAIN.test(domain)) return false;
  try {
    // URL's IDNA validation is used only to check DNS label bounds, never to replace the address.
    const ascii = new URL(`https://${domain}`).hostname;
    return (
      ascii.length <= MAX_DOMAIN_ASCII &&
      ascii.split(".").every((label) => label.length > 0 && label.length <= MAX_LABEL_ASCII)
    );
  } catch {
    return false;
  }
}
