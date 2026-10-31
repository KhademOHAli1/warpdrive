"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { CalendarEventDialog } from "./CalendarEventDialog";
import type { EditableActivity } from "./getForEdit";

// Load the authoritative, visibility-checked record rather than patching a partial grid DTO.
export function CalendarEventEditDialog({
  id,
  onClose,
  onSaved,
  onMarkedDone,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
  onMarkedDone?: (id: string) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const query = trpc.activities.getForEdit.useQuery(
    { id },
    {
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );
  const [snapshot, setSnapshot] = useState<EditableActivity | null>(null);
  // Seed once after this opening's successful read. A background error must neither replace
  // the draft with an older cached record nor unmount the user's unsaved work.
  if ((snapshot === null || snapshot.id !== id) && query.isFetchedAfterMount && query.isSuccess) {
    setSnapshot(query.data);
  }
  if (snapshot !== null && snapshot.id === id)
    return (
      <CalendarEventDialog
        key={id}
        editing={snapshot}
        onClose={onClose}
        onSaved={onSaved}
        onMarkedDone={onMarkedDone}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("editor.edit")}</DialogTitle>
        </DialogHeader>
        {query.isError ? (
          <div className="space-y-4">
            <p role="alert">{t("editor.loadFailed")}</p>
            <Button
              variant="outline"
              onClick={() => {
                void query.refetch();
              }}
            >
              {t("editor.retry")}
            </Button>
          </div>
        ) : (
          <p role="status">{t("editor.loading")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
