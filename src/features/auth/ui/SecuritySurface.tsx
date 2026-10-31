"use client";
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";

export function SecurityPanel({
  title,
  description,
  embedded,
  children,
}: {
  title: string;
  description?: string;
  embedded?: boolean;
  children: ReactNode;
}) {
  if (embedded === true) return <div className="space-y-5">{children}</div>;
  return (
    <SettingsCard>
      <SettingsCardHeader title={title} description={description} />
      <SettingsCardBody className="space-y-5">{children}</SettingsCardBody>
    </SettingsCard>
  );
}

export function SecurityAction({
  icon: Icon,
  title,
  description,
  state,
  positive = false,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  state?: string;
  positive?: boolean;
  action: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const L = authScreensMessagesForLocale(useLocale()).flow;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex flex-col items-start gap-3 px-5 py-5 sm:flex-row sm:items-center sm:gap-4">
        <div className="hidden size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/30 text-muted-foreground sm:flex">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{title}</h3>
            {state !== undefined && (
              <Badge variant={positive ? "success" : "secondary"}>{state}</Badge>
            )}
          </div>
          <div className="text-sm leading-relaxed text-muted-foreground">{description}</div>
        </div>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0">
            {action}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {open && children}
          <DialogFooter className="border-t pt-4">
            <DialogClose asChild>
              <Button variant="ghost">{L.close}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </div>
    </Dialog>
  );
}
