import type { GoogleEvent } from "./schemas";

export type GoogleConferenceState =
  | { state: "none" }
  | { state: "pending" | "failed" | "unavailable"; requestId?: string }
  | { state: "ready"; url: string; requestId?: string };
function meetVideoUrl(uri: string): string | null {
  try {
    const url = new URL(uri);
    return url.protocol === "https:" &&
      url.hostname === "meet.google.com" &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function googleConferenceState(event: GoogleEvent): GoogleConferenceState {
  const conference = event.conferenceData;
  if (conference === undefined) return { state: "none" };
  const request = conference.createRequest;
  const context = request?.requestId !== undefined ? { requestId: request.requestId } : {};
  const status = request?.status?.statusCode;
  if (status === "pending") return { state: "pending", ...context };
  if (status === "failure") return { state: "failed", ...context };
  if (conference.conferenceSolution?.key.type !== "hangoutsMeet")
    return { state: "unavailable", ...context };
  const video = conference.entryPoints?.find((entry) => entry.entryPointType === "video");
  const url = video !== undefined ? meetVideoUrl(video.uri) : null;
  return url === null ? { state: "unavailable", ...context } : { state: "ready", url, ...context };
}
