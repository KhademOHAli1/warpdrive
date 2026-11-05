"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import {
  capturePublicationReview,
  type PublicationReviewSource,
  publicationReviewCurrent,
  publicationReviewSteps,
} from "./publicationReview";

export function WorkflowPublishReview({
  current,
  pending,
  invalid,
  onClose,
  onConfirm,
  onCloseAutoFocus,
}: {
  current: PublicationReviewSource;
  pending: boolean;
  invalid: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useAppTranslations("workflows");
  const [review, setReview] = useState(() => ({
    snapshot: capturePublicationReview(current),
    stale: false,
  }));
  const stale = review.stale || !publicationReviewCurrent(review.snapshot, current);
  // Latch a changed cut even if a later edit returns to the original text/graph.
  // Same-fiber guarded state avoids an effect window that could confirm stale input.
  if (stale && !review.stale) setReview({ ...review, stale: true });
  const steps = publicationReviewSteps(review.snapshot.definition);
  const ready = steps.every((step) => step.ready);
  const blocked =
    pending ||
    stale ||
    invalid ||
    !ready ||
    !current.available ||
    current.archivedAt !== null ||
    !current.capabilities.publish ||
    (current.dirty && !current.capabilities.edit);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("publicationTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("publicationActivation")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-5 text-sm">
          <section className="min-w-0 space-y-1">
            <h3 className="font-medium">{t("publicationWorkflow")}</h3>
            <p dir="auto" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {review.snapshot.name}
            </p>
            <p className="text-muted-foreground">
              {t(review.snapshot.dirty ? "publicationSaveFirst" : "publicationSavedDraft")}
            </p>
          </section>
          <section className="space-y-1">
            <h3 className="font-medium">{t("publicationIdentity")}</h3>
            <p className="text-muted-foreground">{t("publicationIdentityHint")}</p>
          </section>
          <section className="space-y-2">
            <h3 className="font-medium">{t("publicationSteps")}</h3>
            <p className="text-muted-foreground">{t("publicationStepsHint")}</p>
            <ul className="space-y-3">
              {steps.map((step) => (
                <li key={step.id} className="min-w-0 rounded-md border p-3">
                  <p dir="auto" className="break-words font-medium [overflow-wrap:anywhere]">
                    {step.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{t(step.labelKey)}</p>
                  <p className="mt-1 text-muted-foreground">{t(step.descriptionKey)}</p>
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-1">
            <h3 className="font-medium">{t("publicationPermissions")}</h3>
            <p className="text-muted-foreground">{t("publicationPermissionsHint")}</p>
          </section>
          <section className="space-y-1">
            <h3 className="font-medium">{t("publicationConnections")}</h3>
            <p className="text-muted-foreground">
              {t(ready ? "publicationConnectionsLocal" : "publicationConnectionsUnassessed")}
            </p>
          </section>
          <p className="text-muted-foreground">{t("publicationSimulationHint")}</p>
          {!ready && (
            <p role="alert" className="text-destructive">
              {t("notReady")}
            </p>
          )}
          {stale && (
            <div className="space-y-2 rounded-md border p-3">
              <p role="status">{t("publicationChanged")}</p>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  setReview({ snapshot: capturePublicationReview(current), stale: false })
                }
              >
                {t("publicationReviewUpdated")}
              </Button>
            </div>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={blocked}
            className={buttonVariants({ variant: "default", size: "sm" })}
            onClick={(event) => {
              event.preventDefault();
              if (!blocked && publicationReviewCurrent(review.snapshot, current)) onConfirm();
            }}
          >
            {t("publicationConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
