export type DatePreset = "month" | "quarter" | "year" | "last30";

// Arithmetic on the viewer's server-resolved civil date, independent of browser timezone.
export function presetRange(preset: DatePreset, today: string): { from: string; to: string } {
  const year = today.slice(0, 4);
  const month = Number(today.slice(5, 7));
  switch (preset) {
    case "month":
      return { from: `${year}-${today.slice(5, 7)}-01`, to: today };
    case "quarter": {
      const first = String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0");
      return { from: `${year}-${first}-01`, to: today };
    }
    case "last30": {
      const from = new Date(`${today}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 29);
      return { from: from.toISOString().slice(0, 10), to: today };
    }
    case "year":
      return { from: `${year}-01-01`, to: today };
  }
}
