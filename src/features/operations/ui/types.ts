import type { RouterOutputs } from "@/lib/trpc-client";

export type ObservationPage = RouterOutputs["operations"]["observations"];
export type SourcePage = RouterOutputs["operations"]["sources"];
export type IncidentPage = RouterOutputs["operations"]["incidents"];
export type EventPage = RouterOutputs["operations"]["events"];
export type ObservationRow = ObservationPage["items"][number];
export type Observation = NonNullable<ObservationRow["observation"]>;
export type CurrentCursor = NonNullable<ObservationPage["nextCursor"]>;
export type HistoryCursor = NonNullable<EventPage["nextCursor"]>;
