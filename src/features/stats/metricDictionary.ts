// Report definitions describe the existing query populations. They are not KPI authoring
// definitions, evidence of complete history, or a second Goals calculation engine.
export const ANALYTICS_METRIC_DICTIONARY_VERSION = 1;

export const DEAL_RECORD_METRICS = [
  "added",
  "won",
  "lost",
  "open",
  "closed",
  "wonValue",
  "wonCycle",
] as const;

export type DealRecordMetric = (typeof DEAL_RECORD_METRICS)[number];

export const DEAL_REPORT_POLICY = {
  population: "Distinct deals, not contacts, accounts, purchases or interactions.",
  visibility:
    "Reapply the current viewer's deal and pipeline visibility on the server for every read, including record pages and exports.",
  ownerBasis:
    "Current deal owner, after the server resolves the requested owner/team scope and stats.viewOthers permission; not owner at the historical event.",
  archival:
    "Exclude deleted and archived deals and deals in archived pipelines; a later archive or removal restates previous results.",
  currency:
    "Select one stored currency before counting or summing deals. The reporting currency performs no FX conversion; preserve decimal monetary values.",
  dates:
    "The selected civil-date range includes from and to. SQL uses a half-open interval from midnight on from to midnight after to.",
  timeZone:
    "Resolve the viewer's time zone on the server and convert the selected civil midnights into explicit instants. Direct query helpers without a time zone use UTC; never rely on the database session time zone.",
  calendar:
    "Date storage remains Gregorian ISO civil dates. Monthly trend buckets are Gregorian months in the resolved viewer time zone; Persian reporting buckets require actual calendar boundaries and are not implemented by relabeling.",
  legacyTimeZone:
    "Earlier query revisions used PostgreSQL ::date boundaries and database-session-zone month buckets. Those results are not assumed equivalent to explicit viewer-zone reporting near period boundaries.",
  restatement:
    "Read the current deal status, value, owner, pipeline and visibility together with its current created_at, won_time or lost_time. Reopenings, corrections, transfers and access changes can restate an earlier period; these reports are not immutable event history.",
  attribution: "No marketing attribution model is applied to these deal populations.",
} as const;

export interface DealRecordMetricDefinition {
  id: DealRecordMetric;
  title: string;
  basis: "created-date-cohort" | "current-close-date" | "current-inventory";
  dateColumn: "created_at" | "won_time" | "lost_time" | "won_time-or-lost_time" | null;
  currentStatus: readonly ("open" | "won" | "lost")[];
  dateWindowApplied: boolean;
  valueRequired: boolean;
  nonnegativeWonCycleRequired: boolean;
  eligibleRecords: string;
  formula: string;
  numerator: string;
  denominator: string | null;
  units: readonly ("deals" | "report-currency" | "days" | "ratio")[];
  zeroOrMissing: string;
}

export const DEAL_RECORD_METRIC_DICTIONARY = {
  added: {
    id: "added",
    title: "Deals created in period",
    basis: "created-date-cohort",
    dateColumn: "created_at",
    currentStatus: ["open", "won", "lost"],
    dateWindowApplied: true,
    valueRequired: false,
    nonnegativeWonCycleRequired: false,
    eligibleRecords:
      "Eligible deals created inside the selected date window, regardless of current status.",
    formula:
      "Count distinct eligible deal IDs; value is the sum of their non-null current deal values.",
    numerator: "Eligible created deals, or their non-null current deal values for the value total.",
    denominator: null,
    units: ["deals", "report-currency"],
    zeroOrMissing:
      "No eligible deals gives count 0 and value 0; null deal value is not evidence of a zero-valued deal.",
  },
  won: {
    id: "won",
    title: "Deals won in period",
    basis: "current-close-date",
    dateColumn: "won_time",
    currentStatus: ["won"],
    dateWindowApplied: true,
    valueRequired: false,
    nonnegativeWonCycleRequired: false,
    eligibleRecords:
      "Eligible deals whose current status is won and whose won_time is inside the selected date window.",
    formula:
      "Count distinct eligible deal IDs; won value is the sum of their non-null current deal values.",
    numerator: "Eligible won deals, or their non-null current deal values for the won-value total.",
    denominator: null,
    units: ["deals", "report-currency"],
    zeroOrMissing:
      "No eligible wins gives count 0 and value 0. Won deal value is not invoiced revenue, collected revenue or profit.",
  },
  lost: {
    id: "lost",
    title: "Deals lost in period",
    basis: "current-close-date",
    dateColumn: "lost_time",
    currentStatus: ["lost"],
    dateWindowApplied: true,
    valueRequired: false,
    nonnegativeWonCycleRequired: false,
    eligibleRecords:
      "Eligible deals whose current status is lost and whose lost_time is inside the selected date window.",
    formula:
      "Count distinct eligible deal IDs; value is the sum of their non-null current deal values.",
    numerator: "Eligible lost deals, or their non-null current deal values for the value total.",
    denominator: null,
    units: ["deals", "report-currency"],
    zeroOrMissing:
      "No eligible losses gives count 0 and value 0; missing loss timestamps do not enter the period.",
  },
  open: {
    id: "open",
    title: "Open deals now",
    basis: "current-inventory",
    dateColumn: null,
    currentStatus: ["open"],
    dateWindowApplied: false,
    valueRequired: false,
    nonnegativeWonCycleRequired: false,
    eligibleRecords:
      "Eligible deals whose current status is open, independent of the selected date window.",
    formula:
      "Count distinct eligible deal IDs; open value is the sum of their non-null current deal values.",
    numerator:
      "Current eligible open deals, or their non-null current deal values for the value total.",
    denominator: null,
    units: ["deals", "report-currency"],
    zeroOrMissing:
      "No eligible open deals gives count 0 and value 0; historical opening inventory is unavailable from this measure.",
  },
  closed: {
    id: "closed",
    title: "Closed deals behind win rate",
    basis: "current-close-date",
    dateColumn: "won_time-or-lost_time",
    currentStatus: ["won", "lost"],
    dateWindowApplied: true,
    valueRequired: false,
    nonnegativeWonCycleRequired: false,
    eligibleRecords:
      "The union of the won and lost populations for the selected date window; each deal enters once, according to its current status.",
    formula: "Closed-period win rate = won count / (won count + lost count).",
    numerator: "Count of eligible deals in the won population.",
    denominator:
      "Count of eligible deals in the won population plus count in the lost population; open deals are excluded.",
    units: ["deals", "ratio"],
    zeroOrMissing:
      "No closed deals gives an unavailable rate (null); eligible losses with no wins give a real zero rate.",
  },
  wonValue: {
    id: "wonValue",
    title: "Valued wins behind won deal size",
    basis: "current-close-date",
    dateColumn: "won_time",
    currentStatus: ["won"],
    dateWindowApplied: true,
    valueRequired: true,
    nonnegativeWonCycleRequired: false,
    eligibleRecords:
      "The won population restricted to deals with non-null value; a recorded value of zero remains eligible.",
    formula:
      "Average won deal value = sum(value) / count(value); median won deal value uses the ordered non-null values and averages the two central values for an even sample.",
    numerator: "Sum of non-null current values in the won population for the arithmetic mean.",
    denominator: "Count of won deals with non-null value, not all won deals.",
    units: ["deals", "report-currency"],
    zeroOrMissing:
      "No eligible values gives unavailable average and median (null); a sample of recorded zero values gives a real zero.",
  },
  wonCycle: {
    id: "wonCycle",
    title: "Eligible wins behind won-only cycle",
    basis: "current-close-date",
    dateColumn: "won_time",
    currentStatus: ["won"],
    dateWindowApplied: true,
    valueRequired: false,
    nonnegativeWonCycleRequired: true,
    eligibleRecords:
      "The won population restricted to won_time >= created_at. Null deal value remains eligible; lost and still-open deals are excluded.",
    formula:
      "Cycle days = elapsed seconds from created_at to won_time / 86400; report the arithmetic mean or continuous 50th percentile over eligible cycles.",
    numerator: "Sum of eligible nonnegative elapsed cycle days for the arithmetic mean.",
    denominator: "Count of won deals with nonnegative creation-to-win duration, not all won deals.",
    units: ["deals", "days"],
    zeroOrMissing:
      "No eligible cycles gives unavailable average and median (null); same-instant creation and win gives a real zero-day cycle. This is a won-only measure, not survival analysis.",
  },
} as const satisfies Record<DealRecordMetric, DealRecordMetricDefinition>;

export function getDealRecordMetricDefinition(
  metric: DealRecordMetric,
): DealRecordMetricDefinition {
  return DEAL_RECORD_METRIC_DICTIONARY[metric];
}

// These existing reports are documented separately so their populations cannot be mistaken
// for deal outcome populations. Limitations describe source behavior, not qualified methods.
export const EXISTING_REPORT_METRIC_DICTIONARY = {
  wonTrend: {
    basis:
      "Won population grouped into Gregorian months in the explicitly resolved viewer time zone.",
    formula:
      "Count distinct deals and sum non-null current values per month; missing months are filled with zero.",
    limitation:
      "At most 60 months are returned; the SQL range truncates with the displayed series. Persian labels do not change these month boundaries.",
  },
  completedActivities: {
    basis: "Non-deleted activities currently marked done with done_at in the period.",
    formula: "Count distinct activity IDs; no completion-rate denominator is defined.",
    visibility:
      "Apply dominant-parent visibility (deal, then person, then organization, then parentless activity visibility) and current assignee scope. A selected pipeline restricts to deal-linked activities in that pipeline.",
    limitation:
      "Activity counts are not filtered by deal reporting currency and are not evidence of caused sales.",
  },
  addedActivities: {
    basis: "Non-deleted visible activities created in the period, regardless of done status.",
    formula:
      "Count distinct activity IDs within current assignee and optional deal-pipeline scope.",
  },
  scheduledActivities: {
    basis:
      "Non-deleted visible activities currently not done whose resolved due day is in the period. Canonical all-day due_date remains a civil date; timed and legacy due_at instants project to the viewer time zone.",
    formula:
      "Count distinct activity IDs within current assignee and optional deal-pipeline scope.",
    limitation:
      "This is a different population from completed activities, so their ratio is not a completion rate.",
  },
  undatedActivities: {
    basis:
      "Current non-deleted visible activities not done and without a resolved due day; independent of the selected period. A canonical all-day due_date remains dated even when due_at is null.",
    formula:
      "Count distinct activity IDs within current assignee and optional deal-pipeline scope.",
  },
  activityTypes: {
    basis: "Completed-activity population grouped by each current non-archived activity type.",
    formula:
      "Count activity IDs per type, including zero rows for current types without eligible completions.",
  },
  funnelReached: {
    basis:
      "Deals created in the selected period, observed through current state and available stage change logs at read time.",
    formula:
      "Count distinct cohort deals whose furthest current stage order or recorded destination stage order is at least the displayed stage order.",
    limitation:
      "Lower-stage passage is inferred, not proof of observed entry. Current stage definitions are used; there is no equal-age observation cutoff or stage-definition version guarantee.",
  },
  funnelConversion: {
    basis: "The legacy funnel reached population, not closing-period win rate.",
    formula:
      "Stage reached count / first displayed stage reached count; the existing query returns zero when the denominator is zero.",
    limitation:
      "All-pipeline rows merge by stage position without a business-stage mapping; they must not be interpreted as a qualified common journey or consecutive-stage conversion.",
  },
  legacyStageDuration: {
    basis:
      "Legacy reconstructed stage intervals for created-date cohort deals; repeated stays contribute multiple intervals.",
    formula: "Continuous 50th percentile of elapsed interval seconds / 86400 by stage.",
    limitation:
      "Current open stays end at now(), so open age and completed duration are mixed. Initial entry can be inferred from creation; timestamp-only ordering is ambiguous for tied moves. This is not a qualified completed-stay or survival measure.",
  },
  stageOpenInventory: {
    basis:
      "Current open-deal inventory by current stage, in one stored currency, independent of the selected period.",
    formula: "Count distinct eligible deal IDs and sum non-null current values per stage.",
    limitation:
      "Router pipeline visibility gates must remain applied. All-pipeline rows merge by position; multi-pipeline medians cannot be rebuilt from medians.",
  },
  lostReasons: {
    basis:
      "Lost population grouped by current structured reason ID and resolved reason name, with free-text fallback.",
    formula:
      "Count distinct eligible deals and sum their non-null current values per reason group.",
    limitation:
      "A null reason remains an explicit missing-reason group. Recorded reasons are descriptive and do not establish causation.",
  },
} as const;

export const GOALS_ANALYTICS_BOUNDARY = {
  authoringOwner: "Settings → Goals",
  analyticsRole:
    "Consume agreed goal, target and scorecard outputs through a read-only adapter; keep report calculations separate from KPI authoring.",
  scope:
    "A goal retains its own dates, assignee scope, currency and definition version; dashboard filters must not silently redefine it.",
  missing:
    "Unavailable or incompatible Goals outputs remain explicit and are not replaced with invented targets or a second definition engine.",
} as const;
