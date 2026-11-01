"use client";

import { Checkbox } from "@/components/ui/Checkbox";
import {
  GLOBAL_FLAGS,
  OWNERSHIP_FLAGS,
  type OwnershipCapability,
  type PermissionFlagKey,
  TEAM_SCOPED_FLAGS,
  type TeamScopedCapability,
} from "@/constants/permissionFlags";
import { settingsPermissionLabel } from "@/features/identity/settingsMessages";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import styles from "./PermissionFlagGroups.module.css";
import type { PermissionFlagValues } from "./permissionSetFlags";

// Ownership capabilities that also expose a _team variant (a team manager acting on a managed
// member's records). Rendered as a third checkbox alongside own/any. Narrows `cap` so the
// `${cap}_team` flag key is statically one of the four valid team-scoped keys.
function isTeamScoped(cap: OwnershipCapability): cap is TeamScopedCapability {
  return (TEAM_SCOPED_FLAGS as readonly OwnershipCapability[]).includes(cap);
}

function FlagCheckbox({
  flagKey,
  checked,
  onToggle,
  disabled,
}: {
  flagKey: PermissionFlagKey;
  checked: boolean;
  onToggle: (key: PermissionFlagKey) => void;
  disabled: boolean;
}): React.ReactElement {
  const L = useSettingsMessages();
  const label = settingsPermissionLabel(L, flagKey);
  return (
    <div className="flex items-center gap-2 text-sm">
      <Checkbox
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={() => onToggle(flagKey)}
      />
      <span>{label}</span>
    </div>
  );
}

export function PermissionFlagGroups({
  current,
  isPending,
  toggle,
}: {
  current: PermissionFlagValues;
  isPending: boolean;
  toggle: (key: PermissionFlagKey) => void;
}): React.ReactElement {
  const L = useSettingsMessages();
  const T = L._identity.flagEditor;
  return (
    <div className={styles.groups}>
      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase text-muted-foreground">
          {T.global}
        </legend>
        <div className="flex flex-col gap-1.5">
          {GLOBAL_FLAGS.map((key) => (
            <FlagCheckbox
              key={key}
              flagKey={key}
              checked={current[key] === true}
              onToggle={toggle}
              disabled={isPending}
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase text-muted-foreground">
          {T.ownership}
        </legend>
        <div className="flex flex-col gap-2">
          {OWNERSHIP_FLAGS.map((cap) => (
            <div key={cap} className="flex flex-col gap-1 border-b pb-1.5 last:border-b-0">
              <span className="text-xs text-muted-foreground">
                {settingsPermissionLabel(L, cap)}
              </span>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                <FlagCheckbox
                  flagKey={`${cap}_own`}
                  checked={current[`${cap}_own`] === true}
                  onToggle={toggle}
                  disabled={isPending}
                />
                <FlagCheckbox
                  flagKey={`${cap}_any`}
                  checked={current[`${cap}_any`] === true}
                  onToggle={toggle}
                  disabled={isPending}
                />
                {isTeamScoped(cap) && (
                  <FlagCheckbox
                    flagKey={`${cap}_team`}
                    checked={current[`${cap}_team`] === true}
                    onToggle={toggle}
                    disabled={isPending}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
