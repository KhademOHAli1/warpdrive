"use client";

import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { WorkflowReferenceIcon } from "@/features/workflows/ui/WorkflowReferenceIcon";
import styles from "@/features/workflows/ui/workflowPalette.module.css";
import { studioSetupHref } from "./studioModel";
import { studioActionChoices, studioActionGroups, studioActions } from "./studioPresentation";
import type { WorkflowStudioModel } from "./useWorkflowStudio";

export function StudioActionPicker({
  model,
  port,
  edgeId,
  onClose,
}: {
  model: WorkflowStudioModel;
  port?: string;
  edgeId?: string;
  onClose: () => void;
}) {
  const { L, studio } = model;
  const t = useAppTranslations("workflows");
  if (studio === null) return null;
  return (
    <div className={styles.panel} data-studio-action-picker>
      <div className={styles.header}>
        <h2>{t("addAnAction")}</h2>
        <button type="button" className={styles.close} aria-label={L.close} onClick={onClose}>
          <WorkflowReferenceIcon name="x" />
        </button>
      </div>
      <div className={styles.body}>
        {studioActionGroups.map((group) => {
          const choices = studioActionChoices.filter((type) => studioActions[type].group === group);
          return (
            <section key={group} aria-label={L.groups[group]}>
              <h3 className={styles.category}>{L.groups[group]}</h3>
              {choices.map((type) => {
                const appearance = studioActions[type];
                const state = studio.readiness[type]?.state;
                const label = L.blocks[type] ?? type;
                const body = (
                  <>
                    <span className={styles.icon} data-studio-category={group}>
                      <WorkflowReferenceIcon name={appearance.icon} stroke={appearance.stroke} />
                    </span>
                    <span>{label}</span>
                    {state === "needs_connection" && (
                      <span className={styles.restriction}>{L.needsSetup}</span>
                    )}
                  </>
                );
                return state === "needs_connection" && !model.disabled ? (
                  <a key={type} className={styles.row} href={studioSetupHref(type)}>
                    {body}
                  </a>
                ) : (
                  <button
                    type="button"
                    key={type}
                    className={styles.row}
                    aria-disabled={
                      model.disabled || state === "forbidden" || state === "unsupported_in_context"
                    }
                    disabled={
                      model.disabled || state === "forbidden" || state === "unsupported_in_context"
                    }
                    onClick={() => model.add(type, port, edgeId)}
                  >
                    {body}
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
