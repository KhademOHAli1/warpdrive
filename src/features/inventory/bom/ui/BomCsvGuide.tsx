"use client";

import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { bomMessages } from "./messages";

const example = [
  "sku,quantity,unit,child_release,alternates,optional,consumable,inherited,pieces",
  "CABLE-100@A,0.25,m,,CABLE-101@A,false,false,false,3",
  "CONTROL-ASSY@A,1,each,A,,false,false,false,",
].join("\r\n");

export function BomCsvGuide() {
  const t = bomMessages[useLocale()];
  return (
    <details className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">{t.csvGuide}</summary>
      <div className="mt-2 space-y-2">
        <p>{t.csvColumns}</p>
        <p>{t.csvPart}</p>
        <p>{t.csvFlags}</p>
        <p>{t.csvQuantity}</p>
        <p>{t.copyBaseline}</p>
        <pre className="overflow-x-auto rounded border bg-card p-2 text-xs" dir="ltr">
          <code>{example}</code>
        </pre>
        <a
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(`${example}\r\n`)}`}
          download="manufacturing-bom-example.csv"
        >
          <Download aria-hidden="true" />
          {t.downloadSample}
        </a>
      </div>
    </details>
  );
}
