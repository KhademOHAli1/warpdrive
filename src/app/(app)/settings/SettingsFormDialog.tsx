import type { ComponentType, ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function SettingsFormDialog({
  title,
  description,
  icon: Icon,
  layout = "embedded",
  disabled,
  children,
}: {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  layout?: "embedded" | "padded";
  disabled?: boolean;
  children: (controls: {
    close: () => void;
    onPendingChange: (pending: boolean) => void;
  }) => ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const embedded = layout === "embedded";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled} className={embedded ? "w-full sm:w-auto" : undefined}>
          <Icon className="size-4" aria-hidden={true} />
          {title}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={`max-h-[90dvh] overflow-y-auto ${embedded ? "p-0" : "sm:max-w-xl"}`}
      >
        <DialogHeader className={embedded ? "border-b px-5 py-4 pe-12" : undefined}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children({ close: () => setOpen(false), onPendingChange: setPending })}
      </DialogContent>
    </Dialog>
  );
}
