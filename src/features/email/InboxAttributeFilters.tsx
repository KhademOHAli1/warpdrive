"use client";
import type React from "react";
import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, type SelectOption } from "@/components/ui/Select";
import { MAIL_LABELS } from "@/constants/email";
import type { EmailMessages } from "@/features/email/emailMessages";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import type { InboxFilter } from "./emailReads";
import {
  type AttributeFilterState,
  type DateRangePreset,
  NO_ATTRIBUTE_FILTER,
} from "./threadAttributeFilter";

// Follow-up filter offers the actionable states only (waiting/replied/closed). "none"/unset is
// intentionally omitted: followUpStatus null (unset) is distinct from the explicit "none" value,
// so a single "None" filter option would be ambiguous. See implementation notes.
const FOLLOW_UP_FILTER_STATES = ["waiting", "replied", "closed"] as const;

// U5 quick-filters (A12): server-side single-select narrowing surfaced in a shadcn DropdownMenu
// (never a native control). "none" maps back to the "all" InboxFilter so the linking tabs regain
// control. Copy is local (owned-file constant) rather than E to keep this change
// scoped to the files U5 owns.
function localizedQUICK_FILTER_OPTIONS(E: EmailMessages): { value: InboxFilter; label: string }[] {
  return [
    { value: "shared", label: E._extra.shared },
    { value: "private", label: E._extra.private },
    { value: "tracked", label: E._extra.tracked_emails },
    { value: "to_me", label: E._extra.to_me },
    { value: "from_contact", label: E._extra.from_an_existing_contact },
    { value: "linked_open_deal", label: E._extra.linked_with_an_open_deal },
  ];
}

const QUICK_FILTER_NONE = "none";

// The dropdown only owns the six quick-filters; when the active InboxFilter is a linking tab
// (all/unmatched/needs_linking) no radio is checked and the "None" reset is selected.
function isQuickFilter(f: InboxFilter, E: EmailMessages): boolean {
  return localizedQUICK_FILTER_OPTIONS(E).some((o) => o.value === f);
}

function QuickFilterMenu({
  quickFilter,
  onQuickFilterChange,
}: {
  quickFilter: InboxFilter;
  onQuickFilterChange: (next: InboxFilter) => void;
}): React.ReactNode {
  const E = useEmailMessages();

  const radioValue = isQuickFilter(quickFilter, E) ? quickFilter : QUICK_FILTER_NONE;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {E._extra.moreFilters}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{E._extra.moreFilters}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={radioValue}
          onValueChange={(v) =>
            onQuickFilterChange(v === QUICK_FILTER_NONE ? "all" : (v as InboxFilter))
          }
        >
          <DropdownMenuRadioItem value={QUICK_FILTER_NONE}>{E._extra.none}</DropdownMenuRadioItem>
          {localizedQUICK_FILTER_OPTIONS(E).map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Toggle label + its accessible name paired with a labelled checkbox (design-system control).
function FilterToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.ReactNode {
  const id = useId();
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Checkbox id={id} label={label} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id}>{label}</label>
    </span>
  );
}

// Surfaced inbox filters (IB1 + P2): follow-up status + label (single-select), attachment/unread
// toggles, a date-range preset, and a Clear reset. All shadcn primitives, no native controls.
export function InboxAttributeFilters({
  value,
  onChange,
  // U5 server-side quick-filter (single-select). Optional so existing callers that only drive the
  // client-side attribute filters keep working; defaults to "all" (no quick-filter) + a no-op.
  quickFilter = "all",
  onQuickFilterChange = () => {},
  onClear,
}: {
  value: AttributeFilterState;
  onChange: (next: AttributeFilterState) => void;
  quickFilter?: InboxFilter;
  onClear?: () => void;
  onQuickFilterChange?: (next: InboxFilter) => void;
}): React.ReactNode {
  const E = useEmailMessages();

  const inbox = E;
  const statusNames = inbox.followUpStatusNames;
  const labelNames = inbox.labelNames;
  const followUpOptions: SelectOption[] = [
    { value: "", label: E._extra.all_follow_ups },
    ...FOLLOW_UP_FILTER_STATES.map((s) => ({ value: s, label: statusNames[s] })),
  ];
  const labelOptions: SelectOption[] = [
    { value: "", label: E._extra.all_labels },
    ...MAIL_LABELS.map((l) => ({ value: l, label: labelNames[l] })),
  ];
  const dateRangeOptions: SelectOption[] = [
    { value: "any", label: inbox.dateRangeAny },
    { value: "7d", label: inbox.dateRange7d },
    { value: "30d", label: inbox.dateRange30d },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        ariaLabel={E._extra.follow_up_status_filter}
        value={value.followUp}
        onChange={(followUp) => onChange({ ...value, followUp })}
        placeholder={E._extra.follow_up}
        options={followUpOptions}
        triggerClassName="w-auto"
      />
      <Select
        ariaLabel={E._extra.label_filter}
        value={value.label}
        onChange={(label) => onChange({ ...value, label })}
        placeholder={E._extra.label}
        options={labelOptions}
        triggerClassName="w-auto"
      />
      <FilterToggle
        label={inbox.hasAttachmentLabel}
        checked={value.hasAttachment}
        onChange={(hasAttachment) => onChange({ ...value, hasAttachment })}
      />
      <FilterToggle
        label={inbox.unreadOnlyLabel}
        checked={value.unreadOnly}
        onChange={(unreadOnly) => onChange({ ...value, unreadOnly })}
      />
      <Select
        ariaLabel={inbox.dateRangeLabel}
        value={value.dateRange}
        onChange={(dateRange) => onChange({ ...value, dateRange: dateRange as DateRangePreset })}
        placeholder={inbox.dateRangeLabel}
        options={dateRangeOptions}
        triggerClassName="w-auto"
      />
      <QuickFilterMenu quickFilter={quickFilter} onQuickFilterChange={onQuickFilterChange} />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          // Clear resets BOTH the client-side attribute filters and the server-side quick-filter;
          // resetting only the former left the list narrowed by a still-active quick-filter (codex
          // review). "all" is the no-quick-filter state (the linking tabs regain control).
          if (onClear) {
            onClear();
            return;
          }
          onChange(NO_ATTRIBUTE_FILTER);
          onQuickFilterChange("all");
        }}
      >
        {inbox.clearFilters}
      </Button>
    </div>
  );
}
