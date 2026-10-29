"use client";
import { useEmailMessages } from "@/features/email/useEmailMessages";
// ComposerFooter: right-aligned Discard then the Send split (Send + Send later), matching PD's
// action-bar order (Discard sits to the left of Send).
// Phase 7: Send later is enabled when onSendLater is provided and a send is possible;
// clicking it opens localized date/time controls in the account timezone. A strictly-future
// time calls onSendLater(Date); invalid or past times show an inline validation message.
// Left slot holds open-tracking and link-tracking toggles plus add-as-activity (available
// from both deal and inbox context). The signature picker lives in the composer toolbar,
// not here, see Composer.tsx.
// Right cluster includes the read-only VisibilityControl.

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { ToggleField } from "@/components/ui/ToggleField";
import { Tip } from "@/components/ui/tooltip";
import type { EmailVisibility } from "../threadVisibility";
import { AddActivityToggle } from "./AddActivityToggle";
import { ScheduleSendPicker } from "./ScheduleSendPicker";
import { VisibilityControl } from "./VisibilityControl";

interface ComposerFooterProps {
  canSend: boolean;
  sending: boolean;
  onSend: () => void;
  onDiscard: () => void;
  trackOpens: boolean;
  onTrackOpensChange: (v: boolean) => void;
  trackLinks: boolean;
  onTrackLinksChange: (v: boolean) => void;
  // Available from both deal and inbox context: show add-as-activity toggle.
  showAddAsActivity?: boolean;
  addAsActivity?: boolean;
  onAddAsActivityChange?: (v: boolean) => void;
  // Phase 7: when provided, enables the Send later button and handles scheduled send.
  onSendLater?: (scheduledAt: Date) => void;
  // C1: interactive compose privacy. Optional (defaults to shared) so existing render sites and
  // tests that predate the control keep working; Composer always supplies both.
  visibility?: EmailVisibility;
  onVisibilityChange?: (v: EmailVisibility) => void;
  // Hidden on a reply to an existing thread: the send path preserves that thread's visibility, so
  // the picker would be a no-op there (the reader's thread-privacy toggle governs instead). Defaults
  // to shown for a new compose (codex P2).
  showVisibility?: boolean;
}

export function ComposerFooter({
  canSend,
  sending,
  onSend,
  onDiscard,
  trackOpens,
  onTrackOpensChange,
  trackLinks,
  onTrackLinksChange,
  showAddAsActivity = false,
  addAsActivity = false,
  onAddAsActivityChange,
  onSendLater,
  visibility = "shared",
  onVisibilityChange,
  showVisibility = true,
}: ComposerFooterProps): React.ReactNode {
  const E = useEmailMessages();

  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Left slot: tracking toggles + add-as-activity (available from deal and inbox context). */}
      <div className="flex items-center gap-2">
        <ToggleField
          control="switch"
          label={E._extra.opens}
          accessibleLabel={E._extra.track_opens}
          checked={trackOpens}
          onCheckedChange={onTrackOpensChange}
        />
        <ToggleField
          control="switch"
          label={E._extra.links}
          accessibleLabel={E._extra.track_links}
          checked={trackLinks}
          onCheckedChange={onTrackLinksChange}
        />
        {showAddAsActivity && onAddAsActivityChange !== undefined && (
          <AddActivityToggle checked={addAsActivity} onChange={onAddAsActivityChange} />
        )}
      </div>

      <div className="ms-auto flex items-center gap-2">
        {/* Interactive privacy picker (right cluster): Private / Shared, threaded into the send. */}
        {showVisibility && (
          <VisibilityControl value={visibility} onChange={(v) => onVisibilityChange?.(v)} />
        )}

        {/* Discard sits to the LEFT of the Send split to match PD's action-bar order. */}
        <button
          type="button"
          onClick={onDiscard}
          className="px-3 py-1.5 rounded-md border border-border text-sm text-muted-foreground transition-[transform,background-color,color] hover:bg-accent hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={E._extra.discard}
        >
          {E._extra.discard}
        </button>

        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            {/* Send split: Send (green) + Send later (enabled when onSendLater provided). */}
            <button
              type="button"
              onClick={onSend}
              disabled={sending || !canSend}
              className="px-3 py-1.5 rounded-s-md bg-success text-success-foreground text-sm font-medium transition-[transform,opacity] hover:opacity-90 active:scale-[0.96] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {E.send}
            </button>
            <Tip label={onSendLater === undefined ? E._extra.coming_soon : E._extra.send_later}>
              <button
                type="button"
                disabled={sending || !canSend || onSendLater === undefined}
                aria-label={E._extra.send_later}
                onClick={() => {
                  if (onSendLater !== undefined) setShowPicker((p) => !p);
                }}
                className="px-2 py-1.5 rounded-e-md border-s border-success-foreground/20 bg-success text-success-foreground text-sm font-medium transition-[transform,opacity] hover:opacity-90 active:scale-[0.96] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </Tip>
          </div>
          <ScheduleSendPicker
            open={showPicker}
            disabled={sending || !canSend || onSendLater === undefined}
            onScheduled={onSendLater}
            onClose={() => setShowPicker(false)}
          />
        </div>
      </div>
    </div>
  );
}
