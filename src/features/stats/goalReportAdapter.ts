import type { GoalWithProgress } from "@/features/goals/router";

// The dashboard consumes the Goals owner's computed output. It must never recalculate
// progress, apply dashboard filters to a goal, or author a competing KPI definition.
// A future KPI/scheme supplier replaces this adapter after its contract is agreed.
export interface GoalReportScorecard {
  source: "goals.list-v1";
  definition: GoalWithProgress["goal"];
  progress: GoalWithProgress["progress"];
  series: GoalWithProgress["series"];
}

export function adaptGoalReport(row: GoalWithProgress): GoalReportScorecard {
  return {
    source: "goals.list-v1",
    definition: row.goal,
    progress: row.progress,
    series: row.series,
  };
}
