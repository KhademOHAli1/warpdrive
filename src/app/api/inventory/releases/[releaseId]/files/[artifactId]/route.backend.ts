import { readReleaseArtifactDownload } from "@/features/inventory/releases/artifacts";
import { releaseDownloadInput } from "@/features/inventory/releases/liveContracts";
import { createContext } from "@/server/trpc/context";

const privateCache = "private, no-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ releaseId: string; artifactId: string }> },
) {
  const { searchParams } = new URL(request.url);
  const parsed = releaseDownloadInput.safeParse({
    ...(await params),
    orderId: searchParams.get("orderId") ?? undefined,
  });
  const missing = () =>
    new Response(null, { status: 404, headers: { "cache-control": privateCache } });
  if (!parsed.success) return missing();

  const { db, session } = await createContext();
  if (session === null) return missing();
  const result = await readReleaseArtifactDownload(
    db,
    session,
    parsed.data,
    AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
  );
  if (!result.ok) return missing();

  const { bytes, name } = result.value;
  const filename = encodeURIComponent(name).replace(
    /['()*]/g,
    (s) => `%${s.charCodeAt(0).toString(16)}`,
  );
  return new Response(new Uint8Array(bytes), {
    headers: {
      "cache-control": privateCache,
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${filename}`,
      "x-content-type-options": "nosniff",
    },
  });
}
