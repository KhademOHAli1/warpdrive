"use client";
import { Inbox } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./inboxWorkspace.module.css";
import { ThreadPane } from "./ThreadPane";
import { useEmailMessages } from "./useEmailMessages";

export function InboxReaderStack({
  threadId,
  onClose,
  onChanged,
  onComposersChange,
  onSelect,
}: {
  threadId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onComposersChange?: (open: boolean) => void;
  onSelect?: (id: string) => void;
}) {
  const E = useEmailMessages();
  const [retained, setRetained] = useState<ReadonlyMap<string, string | null>>(new Map());
  useEffect(() => {
    onComposersChange?.(retained.size > 0);
  }, [retained.size, onComposersChange]);
  const [blocked, setBlocked] = useState(false);
  const lastHref = useRef("");
  useEffect(() => {
    lastHref.current = window.location.href;
  });
  const onComposerChange = useCallback((id: string, open: boolean, subject?: string | null) => {
    setRetained((previous) => {
      if (previous.has(id) === open && (!open || previous.get(id) === (subject ?? null)))
        return previous;
      const next = new Map(previous);
      if (open) next.set(id, subject ?? null);
      else next.delete(id);
      return next;
    });
  }, []);
  // Open composers stay mounted so in-flight uploads, attachments and unsaved edits survive
  // conversation and folder navigation. Leaving the workspace requires finishing/closing them.
  useEffect(() => {
    if (retained.size === 0) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (anchor === null || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const target = new URL(anchor.href, window.location.href);
      if (target.origin === window.location.origin && target.pathname === "/inbox") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setBlocked(true);
    };
    const back = (event: PopStateEvent) => {
      if (window.location.pathname === "/inbox") return;
      event.stopImmediatePropagation();
      window.history.pushState(null, "", lastHref.current);
      setBlocked(true);
    };
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", back, true);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", back, true);
      window.removeEventListener("beforeunload", unload);
    };
  }, [retained.size]);
  const inactiveDrafts = [...retained].filter(([id]) => id !== threadId);
  const ids = [...new Set([...retained.keys(), ...(threadId === null ? [] : [threadId])])];
  return (
    <div className="flex h-full min-h-0 flex-col">
      {blocked && retained.size > 0 && (
        <p role="alert" className="border-b bg-muted px-4 py-3 text-sm">
          {E.workspace.openDrafts}
        </p>
      )}
      {onSelect !== undefined && inactiveDrafts.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b bg-muted/30 px-4 py-2">
          {inactiveDrafts.map(([id, subject]) => (
            <Button key={id} variant="outline" size="sm" onClick={() => onSelect(id)}>
              {E.workspace.resumeReply(subject ?? E._extra.no_subject)}
            </Button>
          ))}
        </div>
      )}
      {threadId === null && (
        <div className={styles.state}>
          <Inbox aria-hidden="true" className="mb-2 size-8 text-muted-foreground" />
          <h2 className="text-base font-semibold">{E.workspace.choose}</h2>
          <p className="max-w-xs text-sm text-muted-foreground">{E.workspace.chooseHelp}</p>
        </div>
      )}
      {ids.map((id) => (
        <div
          key={id}
          hidden={id !== threadId}
          inert={id !== threadId}
          className={`${styles.readerPane} min-h-0 flex-1`}
        >
          <ThreadPane
            threadId={id}
            trackingBadge={null}
            embedded
            active={id === threadId}
            onClose={onClose}
            onChanged={onChanged}
            onComposerChange={onComposerChange}
          />
        </div>
      ))}
    </div>
  );
}
