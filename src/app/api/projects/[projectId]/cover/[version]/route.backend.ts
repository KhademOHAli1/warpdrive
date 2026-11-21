import { canonicalUuidSchema } from "@/features/agency-projects/valueSchemas";
import { readPrivateProjectCover } from "@/features/projects/brand/cover";
import { createContext } from "@/server/trpc/context";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; version: string }> },
) {
  const { projectId, version } = await params;
  if (
    !canonicalUuidSchema.safeParse(projectId).success ||
    !canonicalUuidSchema.safeParse(version).success
  )
    return new Response(null, { status: 404 });
  const { db, session: staffSession, projectGuest } = await createContext();
  const session = staffSession ?? projectGuest?.session ?? null;
  if (session === null) return new Response(null, { status: 404 });
  const image = await readPrivateProjectCover(
    db,
    session,
    projectId,
    version,
    AbortSignal.timeout(10_000),
  );
  if (!image.ok) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(image.value), {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "image/webp",
      "x-content-type-options": "nosniff",
    },
  });
}
