"use client";

import { FileAttachments } from "@/features/files/FileAttachments";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { catalogMessages } from "./ui/catalogMessages";

export function CatalogPartFiles({ itemId, canUpload }: { itemId: string; canUpload: boolean }) {
  const locale = useLocale();
  return (
    <section className={`${BLOCK_CLASS} ph-no-capture space-y-2 rounded-lg border bg-card p-3`}>
      <h2 className="text-sm font-semibold">{catalogMessages[locale].partFiles}</h2>
      <FileAttachments
        key={itemId}
        entityType="inventory_item"
        entityId={itemId}
        readOnly={!canUpload}
      />
    </section>
  );
}
