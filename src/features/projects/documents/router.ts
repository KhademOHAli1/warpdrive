import { protectedProcedure, router } from "@/server/trpc/trpc";
import {
  listProjectDocumentsInput,
  readProjectDocumentInput,
  readProjectDocumentVersionInput,
} from "./input";
import { listProjectDocuments, readProjectDocument, readProjectDocumentVersion } from "./service";

export const projectDocumentsRouter = router({
  list: protectedProcedure
    .input(listProjectDocumentsInput)
    .query(({ ctx, input }) =>
      listProjectDocuments(ctx.db, ctx.session, input.projectId, AbortSignal.timeout(10_000)),
    ),
  read: protectedProcedure
    .input(readProjectDocumentInput)
    .query(({ ctx, input }) =>
      readProjectDocument(ctx.db, ctx.session, input, AbortSignal.timeout(10_000)),
    ),
  version: protectedProcedure
    .input(readProjectDocumentVersionInput)
    .query(({ ctx, input }) =>
      readProjectDocumentVersion(ctx.db, ctx.session, input, AbortSignal.timeout(10_000)),
    ),
});
