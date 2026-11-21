import { useFormatters } from "@/lib/useFormatters";
import { useHydrated } from "@/lib/useHydrated";
import type { ReturnSummary } from "../contracts";

export function useReturnDisplay() {
  const f = useFormatters();
  const hydrated = useHydrated();
  return {
    quantity: (value: number) => (hydrated ? f.number(value) : String(value)),
    amount: (value: string, currency: string) =>
      hydrated ? f.currency(value, currency) : `${value} ${currency}`,
    date: (value: string) => (hydrated ? f.dateTime(value) : value.slice(0, 10)),
  };
}

export const returnStatusVariants: Record<
  ReturnSummary["status"],
  "secondary" | "outline" | "default"
> = {
  draft: "outline",
  issued: "default",
  onHold: "secondary",
  completed: "outline",
  cancelled: "secondary",
};

export function returnPartLabel({
  code,
  revision,
  serial,
  lot,
}: {
  code: string;
  revision: string;
  serial: string | null;
  lot: string | null;
}) {
  return [code, revision, serial ?? lot].filter(Boolean).join(" · ");
}
