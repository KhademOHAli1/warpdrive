"use client";

import { useMemo, useState } from "react";
import { createTranslator } from "use-intl/core";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { NativeSubjectReviewMessages } from "../privacyNativeSubjectReviewMessages";
import {
  NATIVE_CONTACT_PAGE_SIZE,
  NATIVE_TEXT_SEGMENT_UNITS,
  type NativeContactPoint,
  nativeTextBoundary,
} from "./nativeSubjectReviewCardModel";

type Messages = { L: NativeSubjectReviewMessages };
function PageCount({ page, total, L }: Messages & { page: number; total: number }) {
  const locale = useLocale();
  const format = useFormatters();
  const translate = useMemo(
    () => createTranslator({ locale, messages: { pageCount: L.pageCount } }),
    [locale, L.pageCount],
  );
  return (
    <p className="text-xs text-muted-foreground">
      {translate("pageCount", {
        current: format.number(page + 1),
        total: format.number(total),
      })}
    </p>
  );
}
export function NativeSourceText({ value, L }: Messages & { value: string }) {
  const [selected, setSelected] = useState(0);
  const total = Math.max(1, Math.ceil(value.length / NATIVE_TEXT_SEGMENT_UNITS));
  const page = Math.min(selected, total - 1);
  const begin = nativeTextBoundary(value, page * NATIVE_TEXT_SEGMENT_UNITS);
  const end = nativeTextBoundary(value, (page + 1) * NATIVE_TEXT_SEGMENT_UNITS);
  return (
    <div className="space-y-2">
      <div role="document" aria-label={L.segment} className="whitespace-pre-wrap break-words">
        {value.slice(begin, end)}
      </div>
      {total > 1 && (
        <>
          <PageCount page={page} total={total} L={L} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setSelected(page - 1)}
            >
              {L.previousText}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page === total - 1}
              onClick={() => setSelected(page + 1)}
            >
              {L.nextText}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page === total - 1}
              onClick={() => setSelected(total - 1)}
            >
              {L.lastText}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
export function NativeSourceField({
  label,
  value,
  L,
}: Messages & { label: string; value: string | null }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: A description-list term/value group is not a form fieldset.
    <div role="group" aria-label={label} className="space-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value === null ? L.absent : <NativeSourceText value={value} L={L} />}</dd>
    </div>
  );
}
export function NativeSourcePoints({
  label,
  points,
  L,
}: Messages & { label: string; points: readonly NativeContactPoint[] }) {
  const [selected, setSelected] = useState(0);
  // Duplicate contact values remain distinct without using private source text as React keys.
  const entries = useMemo(
    () => points.map((point) => ({ point, key: crypto.randomUUID() })),
    [points],
  );
  const total = Math.max(1, Math.ceil(points.length / NATIVE_CONTACT_PAGE_SIZE));
  const page = Math.min(selected, total - 1);
  const shown = entries.slice(
    page * NATIVE_CONTACT_PAGE_SIZE,
    (page + 1) * NATIVE_CONTACT_PAGE_SIZE,
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: A description-list term/value group is not a form fieldset.
    <div role="group" aria-label={label} className="space-y-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="space-y-2">
        {shown.length === 0 ? (
          <p>{L.absent}</p>
        ) : (
          <ul className="space-y-3">
            {shown.map(({ point, key }) => (
              <li key={key} className="space-y-1 rounded-md border p-3">
                <NativeSourceText value={point.label} L={L} />
                <NativeSourceText value={point.value} L={L} />
                {point.primary === true && (
                  <p className="text-xs text-muted-foreground">{L.primary}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {total > 1 && (
          <>
            <PageCount page={page} total={total} L={L} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setSelected(page - 1)}
              >
                {L.previousPoints}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === total - 1}
                onClick={() => setSelected(page + 1)}
              >
                {L.nextPoints}
              </Button>
            </div>
          </>
        )}
      </dd>
    </div>
  );
}
