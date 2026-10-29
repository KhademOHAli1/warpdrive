"use client";
import { X } from "lucide-react";
import type React from "react";
import { forwardRef, useEffect, useRef } from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { capture, currentRoute } from "@/features/observability/capture";
import { EVENTS } from "@/features/observability/events";
import { cn } from "@/lib/utils";
import { responsiveMaxWidth } from "./adapterClasses";
import { useDirection } from "./direction";
import * as DialogPrimitive from "./primitives/dialog";

// shadcn Radix Nova Dialog wrapper over @radix-ui/react-dialog. This is the SANCTIONED
// replacement for hand-rolled `fixed inset-0` modal overlays: it brings focus trap, scroll
// lock, Escape-to-close, and portal for free. See CLAUDE.md "Use the design system, never
// reinvent". A lint rule bans new hand-rolled `fixed inset-0` overlays; this file is exempt
// because it IS the sanctioned overlay implementation.
// Records why the last dialog dismissal was requested, for the modal_closed `reason`. Reset to
// "programmatic" whenever a dialog opens, so a suppressed dismissal (e.g. an outside-press that did
// not actually close the dialog) cannot mislabel a later close. Single dialog at a time is the norm
// in this app, so a module-level slot is sufficient.
let lastCloseReason: "user" | "escape" | "outside" | "programmatic" = "programmatic";

function setLastCloseReason(reason: "user" | "escape" | "outside"): void {
  lastCloseReason = reason;
}

function emitModalOpened(): void {
  lastCloseReason = "programmatic";
  capture(EVENTS.modalOpened, { route: currentRoute() });
}

function emitModalClosed(): void {
  capture(EVENTS.modalClosed, { route: currentRoute(), reason: lastCloseReason });
}

export function Dialog(
  props: React.ComponentProps<typeof DialogPrimitive.Dialog>,
): React.ReactNode {
  const { open, defaultOpen } = props;
  const isControlled = open !== undefined;
  // Seeded from the initial open state; tracks the last emitted state so we emit on real transitions.
  const prevOpen = useRef<boolean>(open ?? defaultOpen ?? false);

  // Emit once if the dialog mounts already open (a route-mounted modal, or defaultOpen).
  useEffect(() => {
    if (prevOpen.current) emitModalOpened();
  }, []);

  // For CONTROLLED dialogs the parent `open` prop is the lifecycle source of truth: Radix's
  // onOpenChange fires only for internal interactions, not when a parent flips `open`, so
  // state-driven opens and closes (the "modal closing when it should not" case this feature exists
  // to surface) are observed here rather than in the callback.
  useEffect(() => {
    if (open === undefined || open === prevOpen.current) return;
    prevOpen.current = open;
    if (open) emitModalOpened();
    else emitModalClosed();
  }, [open]);

  const handleOpenChange = (next: boolean): void => {
    if (!isControlled) {
      // Uncontrolled dialogs have no `open` prop to observe, so this callback is their lifecycle
      // source.
      prevOpen.current = next;
      if (next) emitModalOpened();
      else emitModalClosed();
    } else if (!next && prevOpen.current) {
      // Controlled dialogs are normally observed by the [open] effect. But a controlled dialog that
      // is conditionally UNMOUNTED on close (GlobalNoteModal, the convert/merge dialogs) never
      // re-renders with open=false, so the effect never sees the transition. Emit the close here,
      // before the parent callback runs and may unmount us, and mark prevOpen so the [open] effect
      // dedups when the dialog instead stays mounted (avoiding a double modal_closed).
      prevOpen.current = false;
      emitModalClosed();
    }
    props.onOpenChange?.(next);
  };
  return <DialogPrimitive.Dialog {...props} onOpenChange={handleOpenChange} />;
}
export const DialogTrigger = DialogPrimitive.DialogTrigger;
export const DialogClose = DialogPrimitive.DialogClose;

export const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.DialogContent>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.DialogContent>
>(({ className, children, ...props }, ref) => {
  const t = useAppTranslations("sharedUi");
  return (
    <DialogPrimitive.DialogContent
      ref={ref}
      dir={useDirection()}
      showCloseButton={false}
      onEscapeKeyDown={() => setLastCloseReason("escape")}
      onPointerDownOutside={() => setLastCloseReason("outside")}
      onInteractOutside={() => setLastCloseReason("outside")}
      className={cn(
        "w-full max-w-lg gap-4 rounded-lg border bg-background p-6 shadow-lg sm:max-w-lg",
        responsiveMaxWidth(className),
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.DialogClose
        onClick={() => setLastCloseReason("user")}
        className="absolute end-1 top-1 flex size-10 items-center justify-center rounded-sm opacity-70 outline-none transition-opacity duration-150 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
      >
        <X className="size-5" strokeWidth={2.25} />
        <span className="sr-only">{t("close")}</span>
      </DialogPrimitive.DialogClose>
    </DialogPrimitive.DialogContent>
  );
});
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 text-start", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export const DialogTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.DialogTitle>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.DialogTitle>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.DialogTitle
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = forwardRef<
  React.ElementRef<typeof DialogPrimitive.DialogDescription>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.DialogDescription>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.DialogDescription
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";
