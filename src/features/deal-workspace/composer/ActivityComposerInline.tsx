"use client";
import { CalendarClock, Clock, Link2, MapPin, StickyNote, User, Users, Video } from "lucide-react";
import type React from "react";
import { useRef } from "react";
import { Input } from "@/components/ui/Input";
import { Select, type SelectOption } from "@/components/ui/Select";
import { reportTimePickerValidity } from "@/components/ui/timePickerValidity";
import { ACTIVITY_PRIORITY_KEYS } from "@/constants/activityPriorities";
import { FIELD_INPUT as FIELD } from "@/constants/formStyles";
import { ActivityTimeZoneHint } from "@/features/activities/ActivityTimeZoneHint";
import { useComposeInitialFocus } from "@/features/compose/useComposeInitialFocus";
import { RichTextBody } from "@/features/email/composer/RichTextBodyLazy";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { ComposerDisclosureField } from "./ComposerDisclosureField";
import { ComposerFieldRow } from "./ComposerFieldRow";
import { ComposerFooter } from "./ComposerFooter";
import { DateRangeRow } from "./DateRangeRow";
import { FreeBusyIndicator } from "./FreeBusyIndicator";
import { LinkChips } from "./LinkChips";
import { GuestsField, OwnerField } from "./LinkedPeopleFields";
import { TypeIconRail } from "./TypeIconRail";
import { type ActivityComposerProps, useActivityComposer } from "./useActivityComposer";
import { VideoCallField } from "./VideoCallField";

const ICON = "h-4 w-4";

interface Props extends ActivityComposerProps {
  // Collapses the composer back to its one-line prompt (Cancel button). Optional so scopes that
  // mount the composer without a collapse affordance can omit it (defaults to a no-op).
  onCancel?: () => void;
}

// Create OR edit an activity (edit mode when `editing` is set). All state and the submit branching
// live in useActivityComposer; this component is the field layout (PD's 7-icon rail).
export function ActivityComposerInline(props: Props): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const fieldsRef = useRef<HTMLDivElement>(null);

  const subjectRef = useComposeInitialFocus<HTMLInputElement>();
  const {
    draftZone,
    legacyAllDay,
    subjectValue,
    setSubject,
    setSubjectEdited,
    types,
    effectiveTypeId,
    setTypeId,
    startDate,
    setStartDate,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    endDate,
    setEndDate,
    busy,
    priority,
    setPriority,
    participantOptions,
    participants,
    setParticipants,
    location,
    setLocation,
    videoCallUrl,
    setVideoCallUrl,
    note,
    setNote,
    owners,
    ownerId,
    setOwnerId,
    linkTargets,
    links,
    setLink,
    error,
    done,
    setDone,
    pending,
    submit,
    duplicate,
  } = useActivityComposer(props);

  return (
    <div ref={fieldsRef} className="flex flex-col gap-3 p-2 text-sm">
      <Input
        ref={subjectRef}
        data-compose-primary="activity"
        aria-label={translateSales("subject_68971")}
        value={subjectValue}
        onChange={(e) => {
          setSubject(e.target.value);
          setSubjectEdited(true);
        }}
        placeholder={translateSales("subject_68971")}
        className="w-full rounded-md border px-3 py-2 text-display font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
      />
      <TypeIconRail types={types} value={effectiveTypeId} onChange={setTypeId} />

      {/* Each field sits in a ComposerFieldRow with PD's leading-icon gutter (the "7-icon rail"). */}
      <ComposerFieldRow icon={<Clock className={ICON} />}>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeRow
            startDate={startDate}
            onStartDate={setStartDate}
            startTime={startTime}
            onStartTime={setStartTime}
            endTime={endTime}
            onEndTime={setEndTime}
            endDate={endDate}
            onEndDate={setEndDate}
            assigneeId={ownerId}
          />
          <FreeBusyIndicator busy={busy} />
        </div>
      </ComposerFieldRow>

      <ActivityTimeZoneHint
        originalInstant={props.editing?.dueAt}
        timeZone={draftZone}
        date={startDate}
        time={startTime}
        legacy={legacyAllDay}
      />
      <ComposerFieldRow icon={<CalendarClock className={ICON} />}>
        <div className="w-48">
          <Select
            ariaLabel={translateSales("priority_d60db")}
            value={priority}
            onChange={setPriority}
            placeholder={translateSales("computed.noPriority")}
            options={[
              { value: "", label: translateSales("computed.noPriority") },
              ...ACTIVITY_PRIORITY_KEYS.map<SelectOption>((k) => ({
                value: k,
                label: translateSales(
                  k === "high"
                    ? "computed.priorityHigh"
                    : k === "medium"
                      ? "computed.priorityMedium"
                      : "computed.priorityLow",
                ),
              })),
            ]}
          />
        </div>
      </ComposerFieldRow>

      {/* Guests / Location / Video call are PD-style expandable link rows (progressive disclosure);
          Guests starts open because the deal's contact is pre-selected as a participant. */}
      <ComposerFieldRow icon={<Users className={ICON} />} iconAlign="top">
        <GuestsField
          participantOptions={participantOptions}
          participants={participants}
          onParticipants={setParticipants}
        />
      </ComposerFieldRow>

      <ComposerFieldRow icon={<MapPin className={ICON} />}>
        <ComposerDisclosureField
          label={translateSales("location_15b61")}
          hasValue={location !== ""}
        >
          <input
            aria-label={translateSales("location_15b61")}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={translateSales("add_location_db071")}
            className={FIELD}
          />
        </ComposerDisclosureField>
      </ComposerFieldRow>

      <ComposerFieldRow icon={<Video className={ICON} />}>
        <ComposerDisclosureField
          label={translateSales("video_call_7b79b")}
          hasValue={videoCallUrl !== ""}
        >
          <VideoCallField value={videoCallUrl} onChange={setVideoCallUrl} />
        </ComposerDisclosureField>
      </ComposerFieldRow>

      {/* Note: the edit surface uses the same amber tint as the Notes tab (ComposeNoteTab's
          bg-warning/10), so switching composer tabs does not change the note background. */}
      <ComposerFieldRow icon={<StickyNote className={ICON} />} iconAlign="top">
        <div data-testid="note-surface" className="overflow-hidden rounded-md border bg-warning/10">
          <RichTextBody html={note} onChange={setNote} contentClassName="bg-transparent" />
        </div>
      </ComposerFieldRow>

      <ComposerFieldRow icon={<User className={ICON} />}>
        <OwnerField owners={owners} ownerId={ownerId} onOwner={setOwnerId} />
      </ComposerFieldRow>

      {/* Linked deal/person/org rows sit at the bottom of the form, matching PD's arrangement. */}
      <ComposerFieldRow icon={<Link2 className={ICON} />} iconAlign="top">
        <LinkChips targets={linkTargets} value={links} onChange={setLink} />
      </ComposerFieldRow>

      {error !== null && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-700"
        >
          {error}
        </p>
      )}

      <ComposerFooter
        done={done}
        onDone={setDone}
        pending={pending}
        onDuplicate={duplicate}
        onCancel={() => props.onCancel?.()}
        onSave={() => {
          if (reportTimePickerValidity(fieldsRef.current)) void submit();
        }}
      />
    </div>
  );
}
