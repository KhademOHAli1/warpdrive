"use client";
import { Info } from "lucide-react";
import type React from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { PopMenu } from "./PopMenu";

// Static explanatory popover next to the Source origin header (Pipedrive's source-popover-button).
export function SourceOriginInfo(): React.ReactNode {
  const tLeads = useAppTranslations("leads");

  return (
    <PopMenu
      triggerLabel={tLeads("aboutSourceOrigin")}
      triggerClassName="ms-1 inline-flex text-muted-foreground hover:text-foreground"
      panelClassName="w-64 normal-case"
      trigger={<Info aria-hidden="true" className="h-3.5 w-3.5" />}
    >
      {() => (
        <p className="px-2 py-1 text-xs font-normal text-pretty text-muted-foreground">
          {tLeads(
            "sourceOriginRecordsHowALeadEnteredWarpdriveManuallyCreatedImportedCapturedFromAWebFormOrSyncedFromAnotherChannelItIsSetWhenTheLeadIsCreatedAndIsNotEditable",
          )}
        </p>
      )}
    </PopMenu>
  );
}
