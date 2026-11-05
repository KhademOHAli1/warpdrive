"use client";

import { useId } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { ConfigurationValidation } from "../configurationTypes";
import type { WorkflowNode } from "../schemas";
import { type WorkflowScheduleConfig, workflowScheduleConfig } from "../workflowScheduleContract";
import styles from "./workflowInspector.module.css";

const defaults: Record<WorkflowScheduleConfig["interval"], WorkflowScheduleConfig> = {
  minutes: { interval: "minutes", minutes: 15 },
  hours: { interval: "hours", hours: 1, minute: 0 },
  days: { interval: "days", days: 1, hour: 9, minute: 0 },
  custom: { interval: "custom", expression: "0 */1 * * *" },
};
const quantities = {
  minutes: { label: "scheduleMinutesBetween", min: 1, max: 60 },
  hours: { label: "scheduleHoursBetween", min: 1, max: 24 },
  days: { label: "scheduleDaysBetween", min: 1, max: 31 },
  hour: { label: "scheduleHourOfDay", min: 0, max: 23 },
  minute: { label: "scheduleMinuteOfHour", min: 0, max: 59 },
} as const;
const scheduleFields = {
  minutes: ["minutes"],
  hours: ["hours", "minute"],
  days: ["days", "hour", "minute"],
  custom: [],
} as const satisfies Record<
  WorkflowScheduleConfig["interval"],
  readonly (keyof typeof quantities)[]
>;

function isInterval(value: unknown): value is WorkflowScheduleConfig["interval"] {
  return typeof value === "string" && Object.hasOwn(defaults, value);
}

export function ScheduleConfigurationFields({
  node,
  editable,
  onChange,
  validation,
}: {
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
}) {
  const t = useAppTranslations("workflows");
  const id = useId();
  const interval = isInterval(node.config.interval) ? node.config.interval : "days";
  const parsed = workflowScheduleConfig.safeParse(node.config);
  const issue = (field: string) => validation.issues.some(({ path }) => path[0] === field);
  const set = (config: WorkflowNode["config"]) => {
    if (editable) onChange({ ...node, config });
  };
  return (
    <div className="space-y-4">
      <div className={styles.field}>
        <p className={styles.label}>{t("scheduleInterval")}</p>
        <Select
          ariaLabel={t("scheduleInterval")}
          value={interval}
          disabled={!editable}
          options={[
            { value: "days", label: t("scheduleDays") },
            { value: "hours", label: t("scheduleHours") },
            { value: "minutes", label: t("scheduleMinutes") },
            { value: "custom", label: t("scheduleCustom") },
          ]}
          onChange={(value) => {
            if (isInterval(value)) set(defaults[value]);
          }}
        />
        <p className={styles.hint}>{t("scheduleUsesUtc")}</p>
      </div>
      {scheduleFields[interval].map((field) => {
        const { label, min, max } = quantities[field];
        const value = node.config[field];
        return (
          <div className={styles.field} key={field}>
            <label className={styles.label} htmlFor={id + field}>
              {t(label)}
            </label>
            <Input
              id={id + field}
              type="number"
              dir="ltr"
              min={min}
              max={max}
              step={1}
              value={typeof value === "number" ? value : ""}
              disabled={!editable}
              aria-invalid={issue(field)}
              onChange={(event) => {
                const raw = event.currentTarget.value;
                const amount = Number(raw);
                set({
                  ...node.config,
                  interval,
                  [field]: raw === "" || !Number.isFinite(amount) ? null : amount,
                });
              }}
            />
          </div>
        );
      })}
      {interval === "custom" && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id + "expression"}>
            {t("scheduleExpression")}
          </label>
          <Input
            id={id + "expression"}
            dir="ltr"
            maxLength={120}
            value={typeof node.config.expression === "string" ? node.config.expression : ""}
            placeholder="0 */1 * * *"
            disabled={!editable}
            aria-invalid={issue("expression")}
            onChange={(event) => set({ interval, expression: event.currentTarget.value })}
          />
          <p className={styles.hint}>{t("scheduleCronHint")}</p>
        </div>
      )}
      {!parsed.success && (
        <p className="text-xs text-destructive" role="alert">
          {t("scheduleInvalid")}
        </p>
      )}
    </div>
  );
}
