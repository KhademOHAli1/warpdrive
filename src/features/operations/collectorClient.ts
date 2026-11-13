import { request } from "node:http";
import { isAbsolute } from "node:path";
import {
  type CollectorSignatureAuthority,
  OPERATIONS_COLLECTOR_HOST,
  OPERATIONS_COLLECTOR_PATH,
  signOperationsCollectorBatch,
} from "./collectorSignature";
import { operationsBatchSchema } from "./contracts";

export type OperationsSubmission = "accepted" | "rejected" | "unknown";

/** Submit an already serialized, retained sequence once. A lost reply leaves the outcome unknown. */
export function submitOperationsBatch(
  socketPath: string,
  authority: CollectorSignatureAuthority,
  body: string,
  signal: AbortSignal,
): Promise<OperationsSubmission> {
  if (!isAbsolute(socketPath) || !socketPath.endsWith("/collector.sock") || signal.aborted)
    return Promise.resolve("rejected");
  const bytes = Buffer.from(body, "utf8");
  const signed = signOperationsCollectorBatch(authority, bytes, Date.now());
  if (!signed.ok) return Promise.resolve("rejected");
  try {
    const value: unknown = JSON.parse(body);
    const batch = operationsBatchSchema.safeParse(value);
    if (!batch.success || batch.data.generationId !== authority.binding.generationId)
      return Promise.resolve("rejected");
  } catch {
    return Promise.resolve("rejected");
  }
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(18_000)]);
  return new Promise((resolve) => {
    try {
      const outgoing = request(
        {
          socketPath,
          path: OPERATIONS_COLLECTOR_PATH,
          method: "POST",
          agent: false,
          maxHeaderSize: 4_096,
          signal: deadline,
          headers: {
            Host: OPERATIONS_COLLECTOR_HOST,
            Connection: "close",
            "Content-Type": "application/json",
            "Content-Length": bytes.byteLength,
            "X-Warpdrive-Collector-Source": authority.binding.sourceId,
            "X-Warpdrive-Collector-Timestamp": signed.value.timestamp,
            "X-Warpdrive-Collector-Signature": signed.value.signature,
          },
        },
        (response) => {
          // The server uses 204 only for a repository acknowledgement, including
          // an exact durable replay. Other ambiguous outcomes never allow a new identity.
          const status = response.statusCode;
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > 512) {
              resolve("unknown");
              response.destroy();
            }
          });
          response.once("error", () => resolve("unknown"));
          response.once("aborted", () => resolve("unknown"));
          response.once("end", () => {
            if (status === 204 && response.complete && received === 0) resolve("accepted");
            else if (status !== undefined && [400, 404, 405, 408, 409, 413, 417].includes(status))
              resolve("rejected");
            else resolve("unknown");
          });
        },
      );
      outgoing.once("error", () => resolve("unknown"));
      outgoing.end(bytes);
    } catch {
      resolve("unknown");
    }
  });
}
