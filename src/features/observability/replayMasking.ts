// Text of elements carrying this class is masked in replays (the compose editor body).
export const MASK_CLASS = "ph-mask-email";
// Elements carrying this class are blocked from replay entirely, recorded as a placeholder
// box (the received-email iframe, whose contents rrweb would otherwise serialize).
export const BLOCK_CLASS = "ph-block-email";

// Replay may record navigation and timings. Keep authorization headers, signed upload
// forms and private response bodies outside the recorder even with remote recording enabled.
export const sessionRecordingOptions = {
  maskAllInputs: false,
  recordBody: false,
  recordHeaders: false,
  maskTextSelector: `.${MASK_CLASS}`,
  blockSelector: `.${BLOCK_CLASS}`,
  maskCapturedNetworkRequestFn: (request) =>
    containsProjectPublicationLink(request.name) ||
    containsPrivateBookingCalendar(request.name) ||
    request.name.includes("/assets/bookings") ||
    containsPhysicalLabelLink(request.name) ||
    request.name.includes("/operations/scan") ||
    request.name.includes("/operations/labels") ||
    request.name.includes("/assets/tags") ||
    request.name.includes("physicalLabels.") ||
    request.name.includes("assets.tags.") ||
    request.name.includes("/inventory") ||
    request.name.includes("inventory.releases.intake.") ||
    request.name.includes("internalProjects.publication") ||
    request.name.includes("internalProjects.integrator")
      ? null
      : request,
} satisfies NonNullable<PostHogConfig["session_recording"]>;

import type { PostHogConfig } from "posthog-js";
import {
  containsPhysicalLabelLink,
  containsPrivateBookingCalendar,
  containsProjectPublicationLink,
} from "./scrub";
