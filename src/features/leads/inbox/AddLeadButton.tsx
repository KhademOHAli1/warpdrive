"use client";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { AddLeadModal } from "../AddLeadModal";

export interface AddLeadButtonProps {
  baseCurrency?: string;
  // Whether the actor holds data.import; gates the "Import leads" link so it is not a
  // dead-end to the denial page (mirrors SettingsNav hiding the import entry).
  canImport: boolean;
  onCreated: () => void;
}

// "Lead" split button (Pipedrive parity): primary segment opens the Add lead dialog; the attached
// caret opens an options menu with "New lead" and (when permitted) "Import leads" (the latter
// links to /settings/import, now that the import wizard route exists).
export function AddLeadButton({
  baseCurrency,
  canImport,
  onCreated,
}: AddLeadButtonProps): React.ReactNode {
  const tLeads = useAppTranslations("leads");

  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="relative inline-flex">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-s-md bg-action px-3 py-1.5 text-sm font-medium text-action-foreground transition-[opacity,scale] duration-150 ease-out hover:opacity-90 active:scale-[0.96] motion-reduce:transition-opacity"
        >
          {tLeads("lead")}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={tLeads("addLeadOptions")}
            className="rounded-e-md border-s border-action-foreground/20 bg-action px-1.5 py-1.5 text-action-foreground transition-[opacity,scale] duration-150 ease-out hover:opacity-90 active:scale-[0.96] motion-reduce:transition-opacity"
          >
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onSelect={() => setOpen(true)}>{tLeads("newLead")}</DropdownMenuItem>
            {canImport && (
              <DropdownMenuItem asChild>
                <Link href="/settings/import/new">{tLeads("importLeads")}</Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open && (
        <AddLeadModal
          baseCurrency={baseCurrency}
          onClose={() => setOpen(false)}
          onCreated={() => {
            onCreated();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
