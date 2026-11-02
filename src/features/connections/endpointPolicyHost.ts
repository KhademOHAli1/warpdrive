import { isIP } from "node:net";
import { domainToASCII } from "node:url";

const FORBIDDEN_HOST_CHARACTERS = /[\s\\/#?@%]/u;
const ASCII_SPACE = 0x20;
const ASCII_DELETE = 0x7f;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "instance-data.ec2.internal",
  "metadata.azure.internal",
]);

export function canonicalEndpointHost(value: string): string | null {
  if (value.length === 0 || FORBIDDEN_HOST_CHARACTERS.test(value)) return null;
  if (
    [...value].some(
      (character) =>
        character.charCodeAt(0) < ASCII_SPACE || character.charCodeAt(0) === ASCII_DELETE,
    )
  )
    return null;
  const unbracketed = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  const family = isIP(unbracketed);
  if (family === 6) return new URL(`https://[${unbracketed}]/`).hostname.slice(1, -1);
  if (family === 4) return unbracketed;
  const ascii = domainToASCII(value).toLowerCase().replace(/\.$/, "");
  // WHATWG accepts IPv4 shorthand/octal/hex. Do not reinterpret these as DNS names.
  if (ascii.length === 0 || ascii.length > 253 || isIP(ascii) !== 0) return null;
  return ascii.split(".").every((part) => DNS_LABEL.test(part)) ? ascii : null;
}

export function isMetadataHostname(host: string): boolean {
  return METADATA_HOSTS.has(host);
}

export function isLocalEndpointHostname(host: string): boolean {
  if (isIP(host) !== 0) return false;
  return (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}
