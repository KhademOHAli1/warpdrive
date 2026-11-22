import type { LabelFormat } from "./formats";

// Printer floors for this workspace. GS1 application requirements also depend on the
// scanning environment and its symbol specification table.
export const MINIMUM_LABEL_MODULE_MM: Readonly<Record<LabelFormat, number>> = {
  qr: 0.254,
  code128: 0.254,
  code39: 0.254,
  ean13: 0.264,
  datamatrix: 0.254,
  gs1_128: 0.495,
  gs1_datamatrix: 0.396,
};

export const labelPrintMedia = ["a4", "letter", "roll"] as const;
export type LabelPrintMedia = (typeof labelPrintMedia)[number];

export type LabelPrintProfile = {
  media: LabelPrintMedia;
  widthMm: number;
  heightMm: number;
  columns: number;
  rows: number;
  topMm: number;
  rightMm: number;
  bottomMm: number;
  leftMm: number;
  columnGapMm: number;
  rowGapMm: number;
};

export const LABEL_PRINT_PROFILES: Readonly<Record<LabelPrintMedia, LabelPrintProfile>> = {
  a4: {
    media: "a4",
    widthMm: 63.5,
    heightMm: 38.1,
    columns: 3,
    rows: 7,
    topMm: 15.15,
    rightMm: 7.25,
    bottomMm: 15.15,
    leftMm: 7.25,
    columnGapMm: 2.5,
    rowGapMm: 0,
  },
  letter: {
    media: "letter",
    widthMm: 66.675,
    heightMm: 25.4,
    columns: 3,
    rows: 10,
    topMm: 12.7,
    rightMm: 4.7625,
    bottomMm: 12.7,
    leftMm: 4.7625,
    columnGapMm: 3.175,
    rowGapMm: 0,
  },
  roll: {
    media: "roll",
    widthMm: 50,
    heightMm: 30,
    columns: 1,
    rows: 1,
    topMm: 0,
    rightMm: 0,
    bottomMm: 0,
    leftMm: 0,
    columnGapMm: 0,
    rowGapMm: 0,
  },
};

export const MAX_PRINT_LABELS = 500;
export const MAX_LABEL_COPIES = 100;
export const LABEL_INSET_MM = 1.25;
export const LABEL_TEXT_LINE_MM = 3;
export const LABEL_TEXT_GAP_MM = 0.65;

const paper = {
  a4: { widthMm: 210, heightMm: 297 },
  letter: { widthMm: 215.9, heightMm: 279.4 },
};
const epsilonMm = 0.000001;

export type LabelPrintCell = {
  slot: number;
  itemIndex: number;
  copy: number;
  leftMm: number;
  topMm: number;
};

export type LabelPrintLayout = {
  paper: { widthMm: number; heightMm: number };
  pageCapacity: number;
  labelCount: number;
  pages: { pageNumber: number; cells: LabelPrintCell[] }[];
};

type LayoutResult =
  | { layout: LabelPrintLayout }
  | { error: "profile" | "fits" | "start" | "quantity" };

function between(value: number, minimum: number, maximum: number) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function integerBetween(value: number, minimum: number, maximum: number) {
  return Number.isInteger(value) && between(value, minimum, maximum);
}

function layoutPaper(profile: LabelPrintProfile) {
  if (profile.media !== "roll") return paper[profile.media];
  return {
    widthMm: profile.leftMm + profile.widthMm + profile.rightMm,
    heightMm: profile.topMm + profile.heightMm + profile.bottomMm,
  };
}

function validProfile(profile: LabelPrintProfile) {
  const { media, columns, rows, widthMm, heightMm } = profile;
  if (!labelPrintMedia.includes(media)) return false;
  if (!between(widthMm, 14, 300) || !between(heightMm, 12, 400)) return false;
  if (!integerBetween(columns, 1, 20) || !integerBetween(rows, 1, 30)) return false;
  if (
    ![
      profile.topMm,
      profile.rightMm,
      profile.bottomMm,
      profile.leftMm,
      profile.columnGapMm,
      profile.rowGapMm,
    ].every((value) => between(value, 0, 100))
  )
    return false;
  return (
    media !== "roll" ||
    (columns === 1 && rows === 1 && profile.columnGapMm === 0 && profile.rowGapMm === 0)
  );
}

/** Subdivides fixed-size media in physical row order, then continues on fresh pages. */
export function planLabelPrint(
  profile: LabelPrintProfile,
  { items, copies, firstCell }: { items: number; copies: number; firstCell: number },
): LayoutResult {
  if (!validProfile(profile)) return { error: "profile" };
  const page = layoutPaper(profile);
  const { columns, rows, widthMm, heightMm, leftMm, topMm, rightMm, bottomMm } = profile;
  const horizontal = columns * widthMm + (columns - 1) * profile.columnGapMm;
  const vertical = rows * heightMm + (rows - 1) * profile.rowGapMm;
  if (
    leftMm + horizontal + rightMm > page.widthMm + epsilonMm ||
    topMm + vertical + bottomMm > page.heightMm + epsilonMm
  )
    return { error: "fits" };
  const pageCapacity = columns * rows;
  if (!integerBetween(firstCell, 1, pageCapacity)) return { error: "start" };
  const labelCount = items * copies;
  if (
    !integerBetween(items, 1, MAX_PRINT_LABELS) ||
    !integerBetween(copies, 1, MAX_LABEL_COPIES) ||
    labelCount > MAX_PRINT_LABELS
  )
    return { error: "quantity" };

  const pages: LabelPrintLayout["pages"] = [];
  for (let output = 0; output < labelCount; output += 1) {
    const position = firstCell - 1 + output;
    const pageIndex = Math.floor(position / pageCapacity);
    const slot = position % pageCapacity;
    const cell = {
      slot: slot + 1,
      itemIndex: Math.floor(output / copies),
      copy: (output % copies) + 1,
      leftMm: leftMm + (slot % columns) * (widthMm + profile.columnGapMm),
      topMm: topMm + Math.floor(slot / columns) * (heightMm + profile.rowGapMm),
    };
    if (pages[pageIndex] === undefined) pages.push({ pageNumber: pageIndex + 1, cells: [cell] });
    else pages[pageIndex].cells.push(cell);
  }
  return { layout: { paper: page, pageCapacity, labelCount, pages } };
}

export type LabelContentBox = {
  compact: boolean;
  captionWidthMm: number;
  maxWidthMm: number;
  maxHeightMm: number;
};

/** Keep the bar code and its human-readable line together on short labels. */
export function labelContentBox(
  profile: Pick<LabelPrintProfile, "widthMm" | "heightMm">,
  format: LabelFormat,
  hasSubtitle: boolean,
): LabelContentBox {
  const widthMm = profile.widthMm - 2 * LABEL_INSET_MM;
  const heightMm = profile.heightMm - 2 * LABEL_INSET_MM;
  const compact = format === "ean13" && profile.heightMm < 31;
  const captionWidthMm = compact ? Math.min(19, widthMm * 0.26) : widthMm;
  return {
    compact,
    captionWidthMm,
    maxWidthMm: compact ? widthMm - captionWidthMm - LABEL_TEXT_GAP_MM : widthMm,
    maxHeightMm: compact
      ? heightMm - LABEL_TEXT_LINE_MM - LABEL_TEXT_GAP_MM
      : heightMm - (hasSubtitle ? 3 : 2) * LABEL_TEXT_LINE_MM - 2 * LABEL_TEXT_GAP_MM,
  };
}

export function labelMillimetres(value: number): string {
  return `${Math.round(value * 1_000_000) / 1_000_000}mm`;
}

export function labelPagePrintRule({ widthMm, heightMm }: LabelPrintLayout["paper"]): string {
  return `@page { size: ${labelMillimetres(widthMm)} ${labelMillimetres(heightMm)}; margin: 0; }`;
}
