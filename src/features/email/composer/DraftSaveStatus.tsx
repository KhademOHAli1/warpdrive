"use client";
import { useEmailMessages } from "../useEmailMessages";
export function DraftSaveStatus({
  status,
  onRetry,
}: {
  status: "idle" | "saving" | "saved" | "error";
  onRetry: () => void;
}) {
  const E = useEmailMessages();
  if (status === "idle") return null;
  return (
    <div role={status === "error" ? "alert" : "status"} className="text-xs text-muted-foreground">
      {status === "error" ? (
        <>
          {E.workspace.saveFailed}{" "}
          <button type="button" onClick={onRetry} className="underline">
            {E.workspace.retry}
          </button>
        </>
      ) : status === "saving" ? (
        E.workspace.saving
      ) : (
        E.workspace.saved
      )}
    </div>
  );
}
