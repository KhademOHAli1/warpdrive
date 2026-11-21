import { z } from "zod";
import { projectDocumentCollaborationFragment } from "./contracts";

const clientId = z.int().min(0).max(4_294_967_295);
const yjsId = z.strictObject({ client: clientId, clock: z.int().nonnegative() });
const position = z
  .strictObject({
    type: yjsId.nullable(),
    tname: z.literal(projectDocumentCollaborationFragment).nullable(),
    item: yjsId.nullable(),
    assoc: z.int().min(-1).max(1),
  })
  .refine(({ type, tname }) => (type === null) !== (tname === null));

export const projectDocumentCursorInput = z.strictObject({ anchor: position, head: position });
export const projectDocumentPresenceInput = z.strictObject({
  clientId,
  cursor: projectDocumentCursorInput.nullable(),
  leave: z.boolean().optional(),
});
