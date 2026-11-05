"use client";
import { Button } from "@/components/ui/Button";
import { useCompanyMessages } from "../messages";

export function ProfileError({ code }: { code: string }) {
  const m = useCompanyMessages();
  const message =
    code === "conflict" || code === "preview_stale" || code === "replay_conflict"
      ? m.errorConflict
      : code === "fresh_auth_required" || code === "unauthorized"
        ? m.errorFresh
        : code === "forbidden"
          ? m.errorForbidden
          : code === "invalid_input" || code === "asset_invalid"
            ? m.errorInvalid
            : code === "in_use"
              ? m.errorInUse
              : m.errorGeneric;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
export function CommandFeedback({
  state,
  retry,
  discard,
  cancel,
}: {
  state: {
    busy: boolean;
    error: string | null;
    uncertain: boolean;
    command: unknown;
    ack: unknown;
  };
  retry: () => void;
  discard: () => void;
  cancel?: () => void;
}) {
  const m = useCompanyMessages();
  return (
    <div className="space-y-3" aria-live="polite">
      {state.error !== null ? <ProfileError code={state.error} /> : null}
      {state.uncertain ? <p className="text-sm text-muted-foreground">{m.uncertain}</p> : null}
      {state.command !== null ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={state.busy} onClick={retry}>
            {m.retry}
          </Button>
          {!state.uncertain ? (
            <Button type="button" variant="ghost" disabled={state.busy} onClick={discard}>
              {m.discard}
            </Button>
          ) : null}
          {state.uncertain && cancel ? (
            <Button type="button" variant="ghost" disabled={state.busy} onClick={cancel}>
              {m.cancelPending}
            </Button>
          ) : null}
        </div>
      ) : null}
      {state.ack !== null && state.command === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {m.saved}
        </p>
      ) : null}
    </div>
  );
}
