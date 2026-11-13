"use client";

import {
  DialogBackdrop,
  DialogTrigger,
  DialogClose as SdkClose,
  DialogContent as SdkContent,
  DialogDescription as SdkDescription,
  Dialog as SdkRoot,
  DialogTitle as SdkTitle,
} from "@ui-sdk/react/dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { responsiveMaxWidth } from "@/components/ui/adapterClasses";
import { useDirection } from "@/components/ui/direction";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { capture, currentRoute } from "@/features/observability/capture";
import { EVENTS } from "@/features/observability/events";
import { cn } from "@/lib/utils";

type DialogOpenChange = NonNullable<ComponentProps<typeof SdkRoot>["onOpenChange"]>;
type DialogOpenChangeReason = Parameters<DialogOpenChange>[1]["reason"];

function closeReason(
  reason: DialogOpenChangeReason,
): "user" | "escape" | "outside" | "programmatic" {
  switch (reason) {
    case "escape-key":
      return "escape";
    case "outside-press":
      return "outside";
    case "close-press":
    case "action":
    case "trigger-press":
    case "shortcut":
    case "back":
    case "swipe":
      return "user";
    case "imperative":
    case "parent-close":
      return "programmatic";
  }
}

export function Dialog({
  children,
  controller,
  onClose,
}: {
  children: ReactNode;
  controller?: ComponentProps<typeof SdkRoot>["controller"];
  onClose?: (value: string | undefined) => void;
}): ReactNode {
  return (
    <SdkRoot
      controller={controller}
      onOpenChange={(open, details) => {
        if (open) {
          capture(EVENTS.modalOpened, { route: currentRoute() });
        } else {
          capture(EVENTS.modalClosed, {
            route: currentRoute(),
            reason: closeReason(details.reason),
          });
          onClose?.(details.returnValue);
        }
      }}
    >
      {children}
    </SdkRoot>
  );
}

export function DialogContent({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof SdkContent>, "children" | "className"> & {
  children: ReactNode;
  className?: string;
}): ReactNode {
  const t = useAppTranslations("sharedUi");
  return (
    <>
      <DialogBackdrop className="fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs motion-safe:transition-opacity motion-safe:data-[starting-style]:opacity-0 motion-safe:data-[ending-style]:opacity-0" />
      <SdkContent
        dir={useDirection()}
        className={cn(
          "fixed inset-0 z-50 m-auto grid h-fit w-[calc(100%-2rem)] max-w-lg gap-4 rounded-lg border bg-background p-6 text-sm text-foreground shadow-lg outline-none sm:max-w-lg motion-safe:transition-opacity motion-safe:data-[starting-style]:opacity-0 motion-safe:data-[ending-style]:opacity-0",
          responsiveMaxWidth(className),
          className,
        )}
        {...props}
      >
        {children}
        <DialogClose
          aria-label={t("close")}
          className="absolute end-1 top-1 flex size-10 items-center justify-center rounded-sm opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden="true" className="size-5" strokeWidth={2.25} />
        </DialogClose>
      </SdkContent>
    </>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof SdkTitle>): ReactNode {
  return (
    <SdkTitle
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof SdkDescription>): ReactNode {
  return <SdkDescription className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function DialogClose(props: ComponentProps<typeof SdkClose>): ReactNode {
  // WebKit skips implicit button tab stops when Tab starts on the focused dialog content.
  return <SdkClose tabIndex={0} {...props} />;
}

export { DialogTrigger };
