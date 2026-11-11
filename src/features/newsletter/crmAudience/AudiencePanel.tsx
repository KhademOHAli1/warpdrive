"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { panelClass, WriteMessage } from "../campaigns/ui";
import { useNewsletterRead, useNewsletterWrite } from "../ui/client";
import type { AudiencePreview, AudienceViewChoice, SealedAudience } from "./contracts";
import { audienceMessages } from "./messages";

type Purpose = { id: number; name: string };
type Review = { campaignId: number; viewId: string; listId: number };

export function AudiencePanel({
  campaignId,
  sealed,
  canApprove,
  unsaved,
  onApproved,
}: {
  campaignId: number;
  sealed: SealedAudience | null;
  canApprove: boolean;
  unsaved: boolean;
  onApproved: () => Promise<void>;
}) {
  const m = audienceMessages[useLocale()];
  const [viewId, setViewId] = useState("");
  const [listId, setListId] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const views = useNewsletterRead<AudienceViewChoice[]>("crmAudience.views", {}, canApprove);
  const purposes = useNewsletterRead<Purpose[]>("crmAudience.purposes", {}, canApprove);
  const preview = useNewsletterRead<AudiencePreview>(
    "crmAudience.preview",
    review ?? {},
    review !== null && canApprove,
  );
  const write = useNewsletterWrite();
  const result = review === null ? undefined : preview.data;
  const failed = views.isError || purposes.isError || preview.isError;

  function showPreview() {
    if (viewId === "" || listId === "" || unsaved || write.isPending) return;
    if (review?.viewId === viewId && review.listId === Number(listId)) {
      void preview.refetch();
      return;
    }
    setReview({ campaignId, viewId, listId: Number(listId) });
  }

  function approve() {
    const approval = result?.approval;
    if (approval == null || review === null || unsaved || write.isPending) return;
    void write
      .run("crmAudience.freeze", { ...review, approval })
      .then(async () => {
        setReview(null);
        await onApproved();
      })
      .catch(() => undefined);
  }

  return (
    <section className={`${panelClass} grid gap-3 p-4`}>
      <h2 className="text-base font-medium">{m.title}</h2>
      {sealed !== null && <p className="text-sm">{m.approved(sealed.size)}</p>}
      {canApprove && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              ariaLabel={m.view}
              placeholder={m.view}
              value={viewId}
              options={(views.data ?? [])
                .filter((view) => view.available)
                .map((view) => ({ label: view.name, value: view.id }))}
              disabled={write.isPending}
              onChange={(value) => {
                setViewId(value);
                setReview(null);
              }}
            />
            <Select
              ariaLabel={m.purpose}
              placeholder={m.purpose}
              value={listId}
              options={(purposes.data ?? []).map((list) => ({
                label: list.name,
                value: String(list.id),
              }))}
              disabled={write.isPending}
              onChange={(value) => {
                setListId(value);
                setReview(null);
              }}
            />
          </div>
          {unsaved && <p className="text-sm text-muted-foreground">{m.refresh}</p>}
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={
              viewId === "" || listId === "" || unsaved || preview.isFetching || write.isPending
            }
            onClick={showPreview}
          >
            {m.preview}
          </Button>
          {review !== null && preview.isFetching && (
            <p role="status" className="text-sm">
              {m.loading}
            </p>
          )}
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {m.unavailable}
            </p>
          )}
          {result !== undefined && (
            <>
              <p className="text-sm">
                {m.summary(result.eligiblePeople, result.rows.length, result.recipients)}
              </p>
              <div className="max-h-72 overflow-auto rounded-md border">
                <table className="w-full text-start text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th scope="col" className="p-2 text-start">
                        {m.person}
                      </th>
                      <th scope="col" className="p-2 text-start">
                        {m.result}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="p-2">
                          <bdi>{row.name}</bdi>
                        </td>
                        <td className="p-2">{m[row.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                type="button"
                className="w-fit"
                disabled={
                  result.approval === null || unsaved || preview.isFetching || write.isPending
                }
                onClick={approve}
              >
                {m.approve}
              </Button>
            </>
          )}
          <WriteMessage error={write.error} />
        </>
      )}
    </section>
  );
}
