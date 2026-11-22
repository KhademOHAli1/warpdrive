"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { BookingAutomationAccess } from "./automations/contracts";
import {
  retryBookingAutomationRunAction,
  saveBookingAutomationProfileAction,
} from "./automations/webActions";
import type { BookingsWorkspace } from "./contracts";
import { executeBookingFeedAction } from "./feedWebActions";
import type { BookingHandoverAccess } from "./handover/contracts";
import {
  executeHandoverAction,
  lookupHandoverAction,
  readHandoverAction,
} from "./handover/webActions";
import type { BookingMembershipWorkspace } from "./membershipContracts";
import { executeBookingMembershipAction } from "./membershipWebActions";
import { BookingWorkspace } from "./ui/BookingWorkspace";
import { checkAvailabilityAction, executeBookingAction } from "./webActions";

type BookingsLiveProps = {
  actorId: string;
  initial: BookingsWorkspace;
  initialBookingId?: string;
  canBrowseAssets: boolean;
  initialMemberships?: BookingMembershipWorkspace;
};

export function BookingsLive(props: BookingsLiveProps) {
  return props.initial.automationsAvailable === true ? (
    <BookingsLiveWithAutomations {...props} />
  ) : (
    <BookingsLiveWorkspace {...props} />
  );
}

function BookingsLiveWithAutomations(props: BookingsLiveProps) {
  const { actorId } = props;
  const client = trpc.useUtils().client;
  const automationAccess = useMemo<BookingAutomationAccess>(
    () => ({
      readNotices: (bookingId, signal) =>
        client.assets.bookings.automations.notices.query({ bookingId }, { signal }),
      readRuns: (input, signal) => client.assets.bookings.automations.runs.query(input, { signal }),
      saveProfile: (input) => saveBookingAutomationProfileAction(actorId, input, readCsrfToken()),
      retry: (input) => retryBookingAutomationRunAction(actorId, input, readCsrfToken()),
    }),
    [actorId, client],
  );
  return <BookingsLiveWorkspace {...props} automationAccess={automationAccess} />;
}

function BookingsLiveWorkspace({
  actorId,
  initial,
  initialBookingId,
  canBrowseAssets,
  initialMemberships,
  automationAccess,
}: BookingsLiveProps & { automationAccess?: BookingAutomationAccess }) {
  const handover = useMemo<BookingHandoverAccess>(
    () => ({
      read: (bookingId) => readHandoverAction(actorId, bookingId, readCsrfToken()),
      submit: (command) => executeHandoverAction(actorId, command, readCsrfToken()),
      lookup: (bookingId, code) => lookupHandoverAction(actorId, bookingId, code, readCsrfToken()),
    }),
    [actorId],
  );
  const [membershipSource, setMembershipSource] = useState(initialMemberships);
  const [memberships, setMemberships] = useState(initialMemberships);
  if (membershipSource !== initialMemberships) {
    setMembershipSource(initialMemberships);
    // Server Actions may reserialize the previous page snapshot alongside a newer command result.
    if (JSON.stringify(membershipSource) !== JSON.stringify(initialMemberships)) {
      setMemberships(initialMemberships);
    }
  }

  return (
    <BookingWorkspace
      initial={initial}
      initialBookingId={initialBookingId}
      fixture={false}
      canBrowseAssets={canBrowseAssets}
      submit={(command) => executeBookingAction(actorId, command, readCsrfToken())}
      checkAvailability={(input) => checkAvailabilityAction(actorId, input, readCsrfToken())}
      submitFeed={(input) => executeBookingFeedAction(actorId, input, readCsrfToken())}
      handover={initial.handoverAvailable === true ? handover : undefined}
      automationAccess={automationAccess}
      membershipAccess={
        initialMemberships === undefined || memberships === undefined
          ? undefined
          : {
              workspace: memberships,
              submit: async (command) => {
                const result = await executeBookingMembershipAction(
                  actorId,
                  command,
                  readCsrfToken(),
                );
                if (result.ok) setMemberships(result.value);
                return result;
              },
            }
      }
    />
  );
}
