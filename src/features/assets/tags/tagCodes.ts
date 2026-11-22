const tagMarker = "wd-tag:v1:";
const tagPath = "/equipment-tag/";
const maxIdentifierLength = 4_096;

// Keep encoded path separators and dot segments out of parsed scanner routes. Read the literal
// path beside the normalized origin so URL's path normalization cannot turn them into a match.
const originPattern = /^https?:\/\/[^@%/?#\\\s\p{Cc}]+\/?$/iu;
const tagUrlPattern = /^(https?:\/\/[^@%/?#\\\s\p{Cc}]+)(\/[^?#\\\s\p{Cc}]*)$/iu;

export function isAssetTagToken(token: string): boolean {
  return token.length === 22 && /^[A-Za-z0-9_-]+$/.test(token);
}

export function assetTagText(token: string): string {
  return `${tagMarker}${token}`;
}

export function assetTagLandingToken(pathname: string): string | null {
  if (!pathname.startsWith(tagPath)) return null;
  const token = pathname.slice(tagPath.length);
  return isAssetTagToken(token) ? token : null;
}

export function tagOrigin(raw: string): string | null {
  if (!originPattern.test(raw) || /[\s\p{Cc}]/u.test(raw)) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function splitTagUrl(raw: string): { origin: string; path: string } | null {
  if (/[\s\p{Cc}]/u.test(raw)) return null;
  const match = tagUrlPattern.exec(raw);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const origin = tagOrigin(match[1]);
  return origin === null ? null : { origin, path: match[2] };
}

export function assetTagLink(origin: string, token: string): string | null {
  if (!isAssetTagToken(token)) return null;
  const base = tagOrigin(origin);
  return base === null ? null : `${base}${tagPath}${token}`;
}

export function parseAssetTagIdentifier(value: string, expectedOrigin: string): string | null {
  if (value.length > maxIdentifierLength) return null;
  // Supported QR reader preambles and the wedge Enter suffix are scanner framing.
  const scan = value.replace(/^\]Q[012]/, "").replace(/[\r\n]+$/, "");
  if (scan.startsWith(tagMarker)) {
    const token = scan.slice(tagMarker.length);
    return isAssetTagToken(token) ? token : null;
  }
  const expected = tagOrigin(expectedOrigin);
  if (expected === null) return null;
  const link = splitTagUrl(scan);
  return link?.origin === expected ? assetTagLandingToken(link.path) : null;
}
