import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { err, ok } from "@/types/result";
import type {
  ProjectReplayCodec,
  ProjectReplayContext,
  ProjectReplayInput,
} from "./persistence/projectRepositoryTypes";

/** Installation-scoped keyed comparison, separate from token and privacy-case purposes. */
export function createProjectReplayCodec(secret: Buffer): ProjectReplayCodec {
  const key = Buffer.from(
    hkdfSync("sha256", secret, "warpdrive-agency", "request-comparison-v1", 32),
  );
  const keyId = `agency-hmac-v1:${createHash("sha256").update(key).digest("hex")}`;
  function digest(context: ProjectReplayContext, input: ProjectReplayInput) {
    const values =
      context.operation === "create" && "title" in input
        ? [
            input.intentId,
            input.ownerUserId,
            input.title,
            input.dealId,
            input.personId,
            input.orgId,
          ]
        : "projectId" in input
          ? [input.projectId, input.intentId, input.expectedRevision]
          : null;
    return createHmac("sha256", key)
      .update(
        JSON.stringify([
          "agency-request-v1",
          context.actorUserId,
          context.operation,
          context.intentId,
          context.projectId,
          context.revision,
          context.historyId,
          values,
        ]),
      )
      .digest();
  }
  return {
    seal(context, input, signal) {
      return Promise.resolve().then(() => {
        signal.throwIfAborted();
        return ok({ keyId, bytes: digest(context, input) });
      });
    },
    compare(context, envelope, input, signal) {
      return Promise.resolve().then(() => {
        signal.throwIfAborted();
        if (envelope.keyId !== keyId || envelope.bytes.length !== 32)
          return err("project_unavailable" as const);
        return ok(timingSafeEqual(envelope.bytes, digest(context, input)));
      });
    },
  };
}
