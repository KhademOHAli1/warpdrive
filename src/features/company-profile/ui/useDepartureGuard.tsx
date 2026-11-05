"use client";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useCompanyMessages } from "../messages";

type RegisterGuard = (message: string) => () => void;
type Departure = { link: HTMLAnchorElement; href: string; message: string };
const DepartureContext = createContext<RegisterGuard | null>(null);

function departingLink(event: MouseEvent): HTMLAnchorElement | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return null;
  if (!(event.target instanceof Element)) return null;
  const link = event.target.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download")) return null;
  if (link.target !== "" && link.target.toLowerCase() !== "_self") return null;
  const here = window.location;
  if (
    link.origin !== here.origin ||
    (link.pathname === here.pathname && link.search === here.search)
  )
    return null;
  return link;
}

export function DepartureGuardProvider({ children }: { children: ReactNode }) {
  const m = useCompanyMessages();
  const guards = useRef(new Map<symbol, string>());
  const replaying = useRef<HTMLAnchorElement | null>(null);
  const [request, setRequest] = useState<Departure | null>(null);
  const register = useCallback<RegisterGuard>((message) => {
    const registry = guards.current;
    const key = Symbol();
    registry.set(key, message);
    return () => {
      registry.delete(key);
    };
  }, []);

  useEffect(() => {
    const captureLink = (event: MouseEvent) => {
      const link = departingLink(event);
      if (link === null || replaying.current === link) return;
      const message = [...guards.current.values()].at(-1);
      if (message === undefined) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setRequest((current) => current ?? { link, href: link.href, message });
    };
    document.addEventListener("click", captureLink, true);
    return () => document.removeEventListener("click", captureLink, true);
  }, []);

  const confirm = () => {
    if (request === null) return;
    const { link, href } = request;
    setRequest(null);
    // Replay the original link so Next retains its usual navigation and history behavior.
    queueMicrotask(() => {
      if (!link.isConnected || link.href !== href) return;
      replaying.current = link;
      try {
        link.click();
      } finally {
        replaying.current = null;
      }
    });
  };
  return (
    <DepartureContext.Provider value={register}>
      {children}
      <ConfirmDialog
        open={request !== null}
        onOpenChange={(open) => {
          if (!open) setRequest(null);
        }}
        title={m.unsaved}
        description={
          request !== null && request.message !== m.unsaved ? request.message : m.leaveDraftHint
        }
        confirmLabel={m.leavePage}
        cancelLabel={m.cancel}
        onConfirm={confirm}
      />
    </DepartureContext.Provider>
  );
}

export function useDepartureGuard(dirty: boolean, message: string): void {
  const register = useContext(DepartureContext);
  useEffect(() => {
    if (!dirty) return;
    const unregister = register?.(message);
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", unload);
    return () => {
      unregister?.();
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty, message, register]);
}

export function useDraftDismissal(dirty: boolean, locked: boolean, close: () => void) {
  const m = useCompanyMessages();
  const [open, setOpen] = useState(false);
  const dismiss = () => {
    if (locked) return;
    if (dirty) setOpen(true);
    else close();
  };
  return {
    dismiss,
    confirmation: (
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={m.unsaved}
        description={m.discardDraftHint}
        confirmLabel={m.discardDraft}
        cancelLabel={m.cancel}
        pending={locked}
        onConfirm={close}
        destructive
      />
    ),
  };
}
