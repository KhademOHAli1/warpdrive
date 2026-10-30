import { createNote } from "@/features/collaboration/notesRepo";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import type { ImportActor } from "./commit";
import type { RowError } from "./commitHelpers";
import { authorityError, issuesOf } from "./commitHelpers";
import type { ImportContext } from "./externalIds";
import { noteImportRowSchema } from "./importRowSchemas";
import { type ResolvedRecordLinks, resolveRecordLinks } from "./resolveRecordLinks";

const NO_LINKED_RECORD_MESSAGE = "note has no linked record";

type NoteParent = { entityType: "deal" | "person" | "organization"; entityId: string };

function noteParent(links: ResolvedRecordLinks): NoteParent | null {
  if (links.dealId !== null) return { entityType: "deal", entityId: links.dealId };
  if (links.personId !== null) return { entityType: "person", entityId: links.personId };
  if (links.orgId !== null) return { entityType: "organization", entityId: links.orgId };
  return null;
}

export async function applyCreateNote(
  tx: DbOrTx,
  actor: ImportActor,
  mapped: Record<string, unknown>,
  ctx: ImportContext,
  signal: AbortSignal,
): Promise<Result<{ id: string; warnings: RowError[] }, RowError[]>> {
  const parsed = noteImportRowSchema.safeParse(mapped);
  if (parsed.success === false) return err(issuesOf(parsed.error));
  const links = await resolveRecordLinks(tx, actor, ctx, parsed.data, signal);
  if (links.ok === false) return links;
  const parent = noteParent(links.value);
  if (parent === null) return err([{ field: "", message: NO_LINKED_RECORD_MESSAGE }]);
  const created = await createNote(
    tx,
    actor,
    { ...parent, body: parsed.data.body, pinned: false },
    signal,
    parsed.data.createdAt === undefined
      ? {}
      : { createdAtOverride: new Date(parsed.data.createdAt) },
  );
  if (created.ok === false) return err(authorityError(created.error));
  return ok({ id: created.value.id, warnings: [] });
}
