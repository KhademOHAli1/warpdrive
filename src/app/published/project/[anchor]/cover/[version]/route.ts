import { publishedCoverInput } from "@/features/projects/publication/input";
import { readPublishedCoverFromCore } from "@/features/projects/publication/webReads";

const headers = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ anchor: string; version: string }> },
) {
  const input = publishedCoverInput.safeParse(await params);
  if (!input.success) return new Response(null, { status: 404, headers });
  const result = await readPublishedCoverFromCore(input.data.anchor, input.data.version);
  if (!result.ok) return new Response(null, { status: 404, headers });
  return new Response(Uint8Array.from(Buffer.from(result.value.data, "base64")), {
    headers: { ...headers, "content-type": "image/webp" },
  });
}
