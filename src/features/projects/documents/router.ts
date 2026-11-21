import { TRPCError } from "@trpc/server";
import { validateRequestCsrf } from "@/server/trpc/request-csrf";
import { protectedProjectProcedure, router } from "@/server/trpc/trpc";
import {
  collaborateProjectDocumentInput,
  listProjectDocumentsInput,
  readProjectDocumentInput,
  readProjectDocumentVersionInput,
} from "./input";
import {
  collaborateProjectDocument,
  listProjectDocuments,
  readProjectDocument,
  readProjectDocumentVersion,
} from "./service";

export const projectDocumentsRouter = router({
  collaborate: protectedProjectProcedure
    .input(collaborateProjectDocumentInput)
    .mutation(({ ctx, input }) => {
      if (!validateRequestCsrf(ctx.csrf, input.csrfToken).ok)
        throw new TRPCError({ code: "FORBIDDEN" });
      return collaborateProjectDocument(ctx.db, ctx.session, input, AbortSignal.timeout(10_000));
    }),
  list: protectedProjectProcedure
    .input(listProjectDocumentsInput)
    .query(({ ctx, input }) =>
      listProjectDocuments(ctx.db, ctx.session, input.projectId, AbortSignal.timeout(10_000)),
    ),
  read: protectedProjectProcedure
    .input(readProjectDocumentInput)
    .query(({ ctx, input }) =>
      readProjectDocument(ctx.db, ctx.session, input, AbortSignal.timeout(10_000)),
    ),
  version: protectedProjectProcedure
    .input(readProjectDocumentVersionInput)
    .query(({ ctx, input }) =>
      readProjectDocumentVersion(ctx.db, ctx.session, input, AbortSignal.timeout(10_000)),
    ),
});
