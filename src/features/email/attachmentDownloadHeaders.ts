export function attachmentDownloadHeaders(args: { filename: string; mimeType: string }): Headers {
  const filename =
    Array.from(
      args.filename
        .replace(/[\p{Cc}\p{Surrogate}\u202a-\u202e\u2066-\u2069]/gu, "_")
        .replace(/[\\/]/g, "_"),
    )
      .slice(0, 180)
      .join("")
      .trim() || "attachment";
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const mimeType = /^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/i.test(args.mimeType)
    ? args.mimeType
    : "application/octet-stream";
  return new Headers({
    "content-type": mimeType,
    "content-disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
}
