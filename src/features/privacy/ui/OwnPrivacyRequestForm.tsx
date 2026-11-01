"use client";

import { useId } from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { FreshVerification } from "@/features/auth/ui/FreshVerification";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { useFormatters } from "@/lib/useFormatters";
import { privacyRequestMessagesForLocale } from "../privacyRequestMessages";
import { ownRequestFormSchema } from "./ownRequestFormModel";
import {
  type OwnPrivacyRequestFormProps,
  useOwnPrivacyRequestForm,
} from "./useOwnPrivacyRequestForm";

export function OwnPrivacyRequestForm(props: OwnPrivacyRequestFormProps) {
  const locale = useLocale();
  const L = privacyRequestMessagesForLocale(locale);
  const task = useOwnPrivacyRequestForm(props, locale);
  const format = useFormatters();
  const summaryId = useId();
  const descriptionId = useId();
  return (
    <SettingsCard className={`${BLOCK_CLASS} ph-no-capture`}>
      <SettingsCardHeader title={L.title} description={L.description} />
      <SettingsCardBody>
        {task.blocked ? (
          <p role="alert" className="text-sm text-destructive">
            {L.accountChanged}
          </p>
        ) : task.receipt !== null ? (
          <div className="space-y-3 text-sm" dir={directionForLocale(locale)}>
            <p role="status" className="font-medium">
              {L.received}
            </p>
            <p className="text-muted-foreground">{L.receivedDescription}</p>
            <dl className="space-y-2">
              <div>
                <dt className="text-muted-foreground">{L.reference}</dt>
                <dd>
                  <bdi dir="ltr">{task.receipt.id}</bdi>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{L.receivedAt}</dt>
                <dd>
                  <time dateTime={new Date(task.receipt.receivedAt).toISOString()}>
                    {format.dateTime(task.receipt.receivedAt)}
                  </time>
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="space-y-5" dir={directionForLocale(locale)}>
            <form
              aria-label={L.title}
              noValidate
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                task.submit();
              }}
            >
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{L.kind}</p>
                <Select
                  value={task.kind}
                  onChange={(value) => {
                    const kind = ownRequestFormSchema.shape.kind.safeParse(value);
                    if (kind.success) task.setKind(kind.data);
                  }}
                  ariaLabel={L.kind}
                  contentClassName={`${BLOCK_CLASS} ph-no-capture`}
                  disabled={task.busy || task.frozen}
                  options={ownRequestFormSchema.shape.kind.options.map((kind) => ({
                    value: kind,
                    label: L.kinds[kind],
                  }))}
                />
              </div>
              <label htmlFor={summaryId} className="block space-y-1.5">
                <span className="text-sm font-medium">{L.summary}</span>
                <Textarea
                  id={summaryId}
                  value={task.summary}
                  onChange={(event) => task.setSummary(event.target.value)}
                  disabled={task.busy || task.frozen}
                  maxLength={ownRequestFormSchema.shape.summary.maxLength ?? undefined}
                  aria-describedby={descriptionId}
                  aria-invalid={task.error === "invalid_input"}
                />
              </label>
              <p id={descriptionId} className="text-sm text-muted-foreground">
                {L.guidance}
              </p>
              {task.error !== null && (
                <p role="alert" className="text-sm text-destructive">
                  {L.errors[task.error]}
                </p>
              )}
              <Button type="submit" disabled={task.busy}>
                {task.busy ? L.sending : task.frozen ? L.retry : L.submit}
              </Button>
            </form>
            {task.error === "fresh_auth_required" && (
              <FreshVerification
                status={props.securityStatus}
                refresh={task.confirmIdentity}
                providerConfirmation="new_tab"
                embedded
              />
            )}
          </div>
        )}
      </SettingsCardBody>
    </SettingsCard>
  );
}
