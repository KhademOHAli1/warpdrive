import { STRINGS } from "@/constants/strings";

const IMP = STRINGS.settings.importer;

export interface WarnedRow {
  id: string;
  rowNumber: number;
  warnings: { field: string; message: string }[];
}

export function RowWarnings({ rows }: { rows: WarnedRow[] }): React.ReactNode {
  const warned = rows.filter((r) => r.warnings.length > 0);
  if (warned.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h2 className="text-sm font-medium">{IMP.rowWarnings}</h2>
      <ul className="divide-y rounded-md border text-sm">
        {warned.map((r) => (
          <li key={r.id} className="px-3 py-2">
            <span className="font-medium tabular-nums">#{r.rowNumber}</span>{" "}
            <span className="text-amber-700">
              {r.warnings.map((w) => `${w.field}: ${w.message}`).join("; ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
