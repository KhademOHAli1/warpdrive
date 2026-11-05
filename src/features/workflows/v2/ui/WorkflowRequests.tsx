"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { BlockOutput } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { resumeWorkflowV2FormAction } from "../actions";
import { ResponseForm } from "./WorkflowRunPanel";

type Request = { id: string; kind: "form" | "chat"; config: BlockOutput };
type RequestRow = { id: string; kind: "form" | "chat"; title: string | null; createdAt: string };
export function WorkflowRequestResponse({ request }: { request: Request }) {
  const L = useSharedBlocksMessages();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  async function submit(response: BlockOutput) {
    if (lock.current || done) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await resumeWorkflowV2FormAction(
        { waitId: request.id, response, requestKey },
        readCsrfToken(),
      );
      if (result.ok) setDone(true);
      else setError(result.error.id.endsWith("DENIED") ? L.responseRestricted : L.failed);
    } catch {
      setError(L.failed);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/workflows/requests" className="text-xs text-link">
        {L.requests}
      </Link>
      <section className="space-y-4 rounded-md border bg-background p-5">
        <h1 className="text-display font-semibold">
          {request.kind === "form" ? L.blocks.FORM : L.approval}
        </h1>
        {done ? (
          <p role="status" className="text-sm text-muted-foreground">
            {L.responseSubmitted}
          </p>
        ) : (
          <ResponseForm
            wait={request}
            disabled={pending}
            onSubmit={(response) => void submit(response)}
          />
        )}
        {error !== null && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
export function WorkflowRequestList({
  requests,
  error,
}: {
  requests: RequestRow[];
  error: boolean;
}) {
  const L = useSharedBlocksMessages();
  const format = useFormatters();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/workflows" className="text-xs text-link">
        {L.workflows}
      </Link>
      <h1 className="text-display font-semibold">{L.requests}</h1>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {L.failed}
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {requests.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">{L.noRequests}</p>
          ) : (
            requests.map((request) => (
              <Link
                key={request.id}
                href={`/workflows/requests/${request.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 text-xs hover:bg-muted/20"
              >
                <span className="font-medium" dir="auto">
                  {request.title ?? (request.kind === "form" ? L.blocks.FORM : L.approval)}
                </span>
                <span className="text-muted-foreground">{format.dateTime(request.createdAt)}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
