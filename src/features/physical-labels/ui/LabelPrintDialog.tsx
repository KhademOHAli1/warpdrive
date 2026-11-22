"use client";

import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import NextImage from "next/image";
import { type CSSProperties, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatNumber } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import type { LabelFormat } from "../formats";
import {
  LABEL_INSET_MM,
  LABEL_PRINT_PROFILES,
  LABEL_TEXT_GAP_MM,
  LABEL_TEXT_LINE_MM,
  type LabelContentBox,
  type LabelPrintCell,
  type LabelPrintLayout,
  type LabelPrintMedia,
  type LabelPrintProfile,
  labelContentBox,
  labelMillimetres,
  labelPagePrintRule,
  labelPrintMedia,
  MAX_PRINT_LABELS,
  planLabelPrint,
} from "../printLayout";
import styles from "./labelPrint.module.css";

const english = {
  title: "Print labels",
  help: "Match the label stock in your printer, then print at actual size or save as PDF.",
  medium: "Paper or roll",
  a4: "A4 sheet",
  letter: "US Letter sheet",
  roll: "Custom roll",
  widthMm: "Label width",
  heightMm: "Label height",
  columns: "Columns",
  rows: "Rows",
  topMm: "Top margin",
  rightMm: "Right margin",
  bottomMm: "Bottom margin",
  leftMm: "Left margin",
  columnGapMm: "Column gap",
  rowGapMm: "Row gap",
  geometry: "Dimensions in millimetres",
  copies: "Copies per label",
  first: "First cell",
  preview: "Print preview",
  previousPage: "Previous page",
  nextPage: "Next page",
  pageOf: "Page {page} of {pages}",
  summary: "{count} labels · {width} × {height} mm",
  profile: "Enter valid label dimensions, margins, and sheet counts.",
  fits: "These labels and margins exceed the paper size.",
  start: "Choose a first cell on the sheet.",
  quantity: "Choose at least one label and no more than 500 total copies.",
  symbol: "A barcode cannot be printed in this space. Try larger labels or check the code.",
  encoding: "Preparing barcodes…",
  close: "Close",
  print: "Print / Save PDF",
};
type Words = typeof english;

const messages: Record<Locale, Words> = {
  en: english,
  de: {
    title: "Etiketten drucken",
    help: "Wählen Sie die eingelegten Etiketten und drucken Sie in Originalgröße oder speichern Sie als PDF.",
    medium: "Papier oder Rolle",
    a4: "A4-Bogen",
    letter: "US-Letter-Bogen",
    roll: "Benutzerdefinierte Rolle",
    widthMm: "Etikettenbreite",
    heightMm: "Etikettenhöhe",
    columns: "Spalten",
    rows: "Zeilen",
    topMm: "Oberer Rand",
    rightMm: "Rechter Rand",
    bottomMm: "Unterer Rand",
    leftMm: "Linker Rand",
    columnGapMm: "Spaltenabstand",
    rowGapMm: "Zeilenabstand",
    geometry: "Maße in Millimetern",
    copies: "Kopien je Etikett",
    first: "Erste Position",
    preview: "Druckvorschau",
    previousPage: "Vorherige Seite",
    nextPage: "Nächste Seite",
    pageOf: "Seite {page} von {pages}",
    summary: "{count} Etiketten · {width} × {height} mm",
    profile: "Geben Sie gültige Etikettenmaße, Ränder sowie Zeilen und Spalten ein.",
    fits: "Die Etiketten und Ränder überschreiten die Papiergröße.",
    start: "Wählen Sie eine erste Position auf dem Bogen.",
    quantity: "Wählen Sie mindestens ein Etikett und höchstens 500 Kopien insgesamt.",
    symbol:
      "Ein Barcode passt nicht in den verfügbaren Platz. Wählen Sie größere Etiketten oder prüfen Sie den Code.",
    encoding: "Barcodes werden vorbereitet …",
    close: "Schließen",
    print: "Drucken / PDF speichern",
  },
  fa: {
    title: "چاپ برچسب‌ها",
    help: "اندازهٔ برچسب‌های چاپگر را انتخاب کنید و در اندازهٔ واقعی چاپ کنید یا PDF بگیرید.",
    medium: "کاغذ یا رول",
    a4: "برگهٔ A4",
    letter: "برگهٔ US Letter",
    roll: "رول سفارشی",
    widthMm: "عرض برچسب",
    heightMm: "ارتفاع برچسب",
    columns: "ستون‌ها",
    rows: "ردیف‌ها",
    topMm: "حاشیهٔ بالا",
    rightMm: "حاشیهٔ راست",
    bottomMm: "حاشیهٔ پایین",
    leftMm: "حاشیهٔ چپ",
    columnGapMm: "فاصلهٔ ستون‌ها",
    rowGapMm: "فاصلهٔ ردیف‌ها",
    geometry: "ابعاد بر حسب میلی‌متر",
    copies: "تعداد نسخه برای هر برچسب",
    first: "نخستین خانه",
    preview: "پیش‌نمایش چاپ",
    previousPage: "صفحهٔ پیشین",
    nextPage: "صفحهٔ بعد",
    pageOf: "صفحهٔ {page} از {pages}",
    summary: "{count} برچسب · {width} × {height} میلی‌متر",
    profile: "ابعاد، حاشیه‌ها و تعداد ردیف‌ها و ستون‌ها را بررسی کنید.",
    fits: "ابعاد برچسب‌ها و حاشیه‌ها از اندازهٔ برگه بیشتر است.",
    start: "نخستین خانهٔ چاپ روی برگه را انتخاب کنید.",
    quantity: "دست‌کم یک برچسب و در مجموع حداکثر ۵۰۰ نسخه انتخاب کنید.",
    symbol: "یک بارکد در این فضا جا نمی‌شود. برچسب بزرگ‌تری انتخاب کنید یا کد را بررسی کنید.",
    encoding: "در حال آماده‌سازی بارکدها…",
    close: "بستن",
    print: "چاپ / ذخیرهٔ PDF",
  },
};

export type LabelPrintItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  humanReadable: string;
  symbology: LabelFormat;
  value: string;
};

export type LabelPrintSymbol = { src: string; widthMm: number; heightMm: number };
export type LabelPrintEncoder = (input: {
  symbology: LabelFormat;
  value: string;
  maxWidthMm: number;
  maxHeightMm: number;
}) => LabelPrintSymbol | null | Promise<LabelPrintSymbol | null>;

type ProfileField = Exclude<keyof LabelPrintProfile, "media">;
type ProfileDraft = Record<ProfileField, string>;
const labelFields = ["widthMm", "heightMm"] as const;
const gridFields = ["columns", "rows", "columnGapMm", "rowGapMm"] as const;
const marginFields = ["topMm", "rightMm", "bottomMm", "leftMm"] as const;
const profileFields = [...labelFields, ...gridFields, ...marginFields];

function draftFor(media: LabelPrintMedia): ProfileDraft {
  const profile = LABEL_PRINT_PROFILES[media];
  return {
    widthMm: String(profile.widthMm),
    heightMm: String(profile.heightMm),
    columns: String(profile.columns),
    rows: String(profile.rows),
    topMm: String(profile.topMm),
    rightMm: String(profile.rightMm),
    bottomMm: String(profile.bottomMm),
    leftMm: String(profile.leftMm),
    columnGapMm: String(profile.columnGapMm),
    rowGapMm: String(profile.rowGapMm),
  };
}

function numericValue(value: string) {
  return value.trim() === "" ? Number.NaN : Number(value);
}

function readProfile(draft: ProfileDraft, media: LabelPrintMedia): LabelPrintProfile {
  return {
    ...Object.fromEntries(profileFields.map((field) => [field, numericValue(draft[field])])),
    media,
  } as LabelPrintProfile;
}

function PrintField({
  label,
  value,
  unit,
  update,
}: {
  label: string;
  value: string;
  unit?: "mm";
  update: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      <span className="flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          step={unit === "mm" ? "any" : 1}
          min={0}
          value={value}
          dir="ltr"
          inputMode={unit === "mm" ? "decimal" : "numeric"}
          onChange={(event) => update(event.currentTarget.value)}
        />
        {unit === "mm" && (
          <span aria-hidden="true" className="text-xs text-muted-foreground">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

function PrintSettings({
  media,
  draft,
  copies,
  first,
  t,
  chooseMedia,
  setDraft,
  setCopies,
  setFirst,
}: {
  media: LabelPrintMedia;
  draft: ProfileDraft;
  copies: string;
  first: string;
  t: Words;
  chooseMedia: (value: LabelPrintMedia) => void;
  setDraft: (draft: ProfileDraft) => void;
  setCopies: (value: string) => void;
  setFirst: (value: string) => void;
}) {
  const sheet = media !== "roll";
  const fields = sheet ? profileFields : [...labelFields, ...marginFields];
  return (
    <div className="min-w-0 space-y-3">
      <div className="space-y-1">
        <span className="block text-xs font-medium">{t.medium}</span>
        <Select
          ariaLabel={t.medium}
          value={media}
          options={labelPrintMedia.map((value) => ({ value, label: t[value] }))}
          onChange={(choice) => {
            const next = labelPrintMedia.find((value) => value === choice);
            if (next !== undefined) chooseMedia(next);
          }}
        />
      </div>
      <fieldset className="grid min-w-0 grid-cols-2 gap-2">
        <legend className="mb-1.5 text-xs font-semibold text-muted-foreground">{t.geometry}</legend>
        {fields.map((key) => (
          <PrintField
            key={key}
            label={t[key]}
            value={draft[key]}
            unit={key === "columns" || key === "rows" ? undefined : "mm"}
            update={(value) => setDraft({ ...draft, [key]: value })}
          />
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <PrintField label={t.copies} value={copies} update={setCopies} />
        {sheet && <PrintField label={t.first} value={first} update={setFirst} />}
      </div>
    </div>
  );
}

type PreparedLabel = { item: LabelPrintItem; box: LabelContentBox; symbol: LabelPrintSymbol };
type PrintScene = {
  layout: LabelPrintLayout;
  profile: LabelPrintProfile;
  labels: readonly PreparedLabel[];
};

function fitsSymbol(symbol: LabelPrintSymbol, { maxWidthMm, maxHeightMm }: LabelContentBox) {
  return (
    /^data:image\/(?:svg\+xml|png)(?:;[a-z0-9_=-]+)*,/iu.test(symbol.src) &&
    symbol.widthMm > 0 &&
    symbol.widthMm <= maxWidthMm + 0.000001 &&
    symbol.heightMm > 0 &&
    symbol.heightMm <= maxHeightMm + 0.000001
  );
}

async function prepareLabel(
  item: LabelPrintItem,
  dimensions: Pick<LabelPrintProfile, "widthMm" | "heightMm">,
  encode: LabelPrintEncoder,
): Promise<PreparedLabel | null> {
  const box = labelContentBox(dimensions, item.symbology, (item.subtitle ?? "") !== "");
  try {
    const { symbology, value } = item;
    const symbol = await encode({
      symbology,
      value,
      maxWidthMm: box.maxWidthMm,
      maxHeightMm: box.maxHeightMm,
    });
    if (symbol === null || !fitsSymbol(symbol, box)) return null;
    const image = new Image();
    image.src = symbol.src;
    await image.decode();
    return { item, box, symbol };
  } catch {
    return null;
  }
}

function usePrintSymbols(
  items: readonly LabelPrintItem[],
  encode: LabelPrintEncoder,
  widthMm: number,
  heightMm: number,
  enabled: boolean,
) {
  const [prepared, setPrepared] = useState<{
    items: readonly LabelPrintItem[];
    encode: LabelPrintEncoder;
    widthMm: number;
    heightMm: number;
    labels: PreparedLabel[] | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled || items.length > MAX_PRINT_LABELS) return;
    let disposed = false;
    void Promise.all(items.map((item) => prepareLabel(item, { widthMm, heightMm }, encode))).then(
      (results) => {
        if (disposed) return;
        const labels = results.filter((result) => result !== null);
        setPrepared({
          items,
          encode,
          widthMm,
          heightMm,
          labels: labels.length === items.length ? labels : null,
        });
      },
    );
    return () => {
      disposed = true;
    };
  }, [items, encode, widthMm, heightMm, enabled]);
  if (
    prepared?.items !== items ||
    prepared.encode !== encode ||
    prepared.widthMm !== widthMm ||
    prepared.heightMm !== heightMm
  )
    return undefined;
  return prepared.labels;
}

function LabelCell({
  cell,
  label,
  profile,
}: {
  cell: LabelPrintCell;
  label: PreparedLabel;
  profile: LabelPrintProfile;
}) {
  const { item, box, symbol } = label;
  const readableWidth = box.compact ? box.maxWidthMm : box.captionWidthMm;
  const readableSize = Math.min(
    2.47,
    readableWidth / (Math.max(1, [...item.humanReadable].length) * 0.62),
  );
  return (
    <div
      data-label-print-cell={cell.slot}
      data-label-print-format={item.symbology}
      className={`${styles.cell} ${box.compact ? styles.compact : ""}`}
      style={
        {
          insetInlineStart: labelMillimetres(cell.leftMm),
          top: labelMillimetres(cell.topMm),
          width: labelMillimetres(profile.widthMm),
          height: labelMillimetres(profile.heightMm),
          "--label-inset": labelMillimetres(LABEL_INSET_MM),
          "--label-gap": labelMillimetres(LABEL_TEXT_GAP_MM),
          "--label-line": labelMillimetres(LABEL_TEXT_LINE_MM),
          "--caption-width": labelMillimetres(box.captionWidthMm),
          "--readable-font": labelMillimetres(Math.max(1.55, readableSize)),
        } as CSSProperties
      }
    >
      <div className={styles.caption}>
        <bdi className={styles.title}>{item.title}</bdi>
        {item.subtitle != null && item.subtitle !== "" && (
          <bdi className={styles.subtitle}>{item.subtitle}</bdi>
        )}
      </div>
      <NextImage
        className={styles.symbol}
        alt=""
        src={symbol.src}
        unoptimized
        loading="eager"
        width={Math.ceil((symbol.widthMm / 25.4) * 96)}
        height={Math.ceil((symbol.heightMm / 25.4) * 96)}
        style={{
          width: labelMillimetres(symbol.widthMm),
          height: labelMillimetres(symbol.heightMm),
        }}
      />
      <bdi className={styles.readable}>{item.humanReadable}</bdi>
    </div>
  );
}

function Paper({
  scene,
  page,
  preview,
}: {
  scene: PrintScene;
  page: LabelPrintLayout["pages"][number];
  preview: boolean;
}) {
  const {
    layout: { paper },
    labels,
    profile,
  } = scene;
  return (
    <div
      data-label-print-page={page.pageNumber}
      className={`${styles.paper} ${preview ? styles.previewPaper : ""}`}
      style={{ width: labelMillimetres(paper.widthMm), height: labelMillimetres(paper.heightMm) }}
      dir="ltr"
    >
      {page.cells.map((cell) => {
        const label = labels[cell.itemIndex];
        return label === undefined ? null : (
          <LabelCell key={cell.slot} cell={cell} label={label} profile={profile} />
        );
      })}
    </div>
  );
}

function PrintPreview({
  scene,
  pageIndex,
  changePage,
  t,
}: {
  scene: PrintScene;
  pageIndex: number;
  changePage: (index: number) => void;
  t: Words;
}) {
  const preferences = useLocalePreferences();
  const fmt = (value: number) => formatNumber(value, preferences, { maximumFractionDigits: 4 });
  const { pages, labelCount, paper } = scene.layout;
  const current = Math.min(pageIndex, pages.length - 1);
  const page = pages[current];
  if (page === undefined) return null;
  return (
    <section aria-label={t.preview} className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t.summary
            .replace("{count}", () => fmt(labelCount))
            .replace("{width}", () => fmt(paper.widthMm))
            .replace("{height}", () => fmt(paper.heightMm))}
        </p>
        {pages.length > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <Button
              type="button"
              size="icon"
              className="size-8"
              variant="outline"
              aria-label={t.previousPage}
              disabled={current === 0}
              onClick={() => changePage(current - 1)}
            >
              <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
            <span>
              {t.pageOf
                .replace("{page}", () => fmt(current + 1))
                .replace("{pages}", () => fmt(pages.length))}
            </span>
            <Button
              type="button"
              size="icon"
              className="size-8"
              variant="outline"
              aria-label={t.nextPage}
              disabled={current === pages.length - 1}
              onClick={() => changePage(current + 1)}
            >
              <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
      <div
        data-label-print-preview
        className={`${styles.preview} min-w-0 rounded-md border bg-muted p-3`}
      >
        <Paper scene={scene} page={page} preview />
      </div>
    </section>
  );
}

function PrintOutput({ scene }: { scene: PrintScene }) {
  const {
    layout: { paper, pages },
  } = scene;
  const rule = labelPagePrintRule(paper);
  return createPortal(
    <article data-label-print-document className={`${styles.output} ${BLOCK_CLASS} ph-no-capture`}>
      <style media="print">{rule}</style>
      {pages.map((page) => (
        <Paper key={page.pageNumber} scene={scene} page={page} preview={false} />
      ))}
    </article>,
    document.body,
  );
}

export function LabelPrintDialog({
  items,
  encode,
  close,
  restoreFocus,
}: {
  items: readonly LabelPrintItem[];
  encode: LabelPrintEncoder;
  close: () => void;
  restoreFocus: () => void;
}) {
  const { locale } = useLocalePreferences();
  const t = messages[locale];
  const hydrated = useHydrated();
  const [media, setMedia] = useState<LabelPrintMedia>("a4");
  const [draft, setDraft] = useState(() => draftFor("a4"));
  const [copies, setCopies] = useState("1");
  const [first, setFirst] = useState("1");
  const [pageIndex, setPageIndex] = useState(0);
  const profile = readProfile(draft, media);
  const result = planLabelPrint(profile, {
    items: items.length,
    copies: numericValue(copies),
    firstCell: media === "roll" ? 1 : numericValue(first),
  });
  const layout = "layout" in result ? result.layout : null;
  const labels = usePrintSymbols(
    items,
    encode,
    profile.widthMm,
    profile.heightMm,
    hydrated && layout !== null,
  );
  const scene = layout === null || labels == null ? null : { layout, profile, labels };
  const error = "error" in result ? t[result.error] : labels === null ? t.symbol : null;

  function chooseMedia(next: LabelPrintMedia) {
    setMedia(next);
    setDraft(draftFor(next));
    setFirst("1");
    setPageIndex(0);
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          data-label-print-dialog
          className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.help}</DialogDescription>
          </DialogHeader>
          <div className="grid min-w-0 items-start gap-4 md:grid-cols-[minmax(13rem,0.7fr)_minmax(0,1.3fr)]">
            <PrintSettings
              media={media}
              draft={draft}
              copies={copies}
              first={first}
              t={t}
              chooseMedia={chooseMedia}
              setDraft={setDraft}
              setCopies={setCopies}
              setFirst={setFirst}
            />
            {scene !== null ? (
              <PrintPreview scene={scene} pageIndex={pageIndex} changePage={setPageIndex} t={t} />
            ) : (
              <p
                role={error === null ? "status" : "alert"}
                className={`rounded-md border p-3 text-sm ${error === null ? "text-muted-foreground" : "text-destructive"}`}
              >
                {error ?? t.encoding}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t.close}
            </Button>
            <Button
              data-label-print-submit
              type="button"
              disabled={!hydrated || scene === null}
              onClick={() => window.print()}
            >
              <Printer className="size-4" aria-hidden="true" />
              {t.print}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {hydrated && scene !== null && <PrintOutput scene={scene} />}
    </>
  );
}
