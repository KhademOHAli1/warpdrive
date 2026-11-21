import { qualityEvidenceInput } from "@/features/inventory/quality/contracts";
import { readQualityEvidence } from "@/features/inventory/quality/evidence";
import { createContext } from "@/server/trpc/context";

const cache = "private, no-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = qualityEvidenceInput.safeParse({
    targetId: searchParams.get("targetId"),
    runId: searchParams.get("runId"),
    evidenceId: searchParams.get("evidenceId"),
  });
  const missing = () => new Response(null, { status: 404, headers: { "cache-control": cache } });
  if (!parsed.success) return missing();
  const { db, session } = await createContext();
  if (session === null) return missing();
  const result = await readQualityEvidence(
    db,
    session,
    parsed.data,
    AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
  );
  if (!result.ok) return missing();
  const { name, bytes } = result.value;
  const filename = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16)}`,
  );
  return new Response(new Uint8Array(bytes), {
    headers: {
      "cache-control": cache,
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${filename}`,
      "x-content-type-options": "nosniff",
    },
  });
}
