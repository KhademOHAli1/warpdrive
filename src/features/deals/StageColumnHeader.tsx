"use client";
import { Scale } from "lucide-react";
import type { ReactNode } from "react";
import { useDirection } from "@/components/ui/direction";
import { Tip } from "@/components/ui/tooltip";
import { MoneyTotals } from "@/features/currencies/MoneyTotals";
import type { CurrencyTotal } from "@/features/currencies/money";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { accentForOrder, funnelClip, tint } from "./boardStageHeader";
import { StageColumnMenu, type StageColumnMenuProps } from "./StageColumnMenu";

type StageColumnHeaderProps = StageColumnMenuProps & {
  order: number;
  totalValue: string;
  currencyTotals?: CurrencyTotal[];
  dealCount: number;
};

export function StageColumnHeader(props: StageColumnHeaderProps): ReactNode {
  const { stageName, order, totalValue, dealCount, baseCurrency } = props;
  const direction = useDirection();
  const translateSales = useAppTranslations("sales");
  const format = useFormatters();
  const accent = accentForOrder(order);

  return (
    // A dedicated menu slot prevents long or mixed-script titles from sliding under the button.
    <header className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-x-2 gap-y-1.5 pb-1">
      <div
        className="min-w-0 py-2 ps-4 pe-5 text-foreground"
        style={{
          clipPath: funnelClip(order === 0, direction),
          backgroundColor: tint(accent, 0.18),
          borderInlineStart: order === 0 ? `3px solid ${accent}` : undefined,
        }}
      >
        <Tip label={<bdi dir="auto">{stageName}</bdi>}>
          <h3 className="truncate text-start text-base font-semibold leading-5">
            <bdi dir="auto">{stageName}</bdi>
          </h3>
        </Tip>
      </div>
      <StageColumnMenu {...props} />
      <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-muted-foreground">
        <Scale data-stage-metric-icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        {props.currencyTotals !== undefined && props.currencyTotals.length > 0 ? (
          <MoneyTotals totals={props.currencyTotals} />
        ) : (
          <bdi dir="auto" className="tabular-nums">
            {format.currency(totalValue, baseCurrency)}
          </bdi>
        )}
        <span aria-hidden="true">·</span>
        <bdi dir="auto" className="tabular-nums">
          {translateSales("stageDealCount", { count: dealCount })}
        </bdi>
      </div>
    </header>
  );
}
