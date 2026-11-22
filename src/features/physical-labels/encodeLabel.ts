import type { LabelRecord } from "./contracts";
import { gs1PrintText, type LabelFormat, physicalLabelScanUrl } from "./formats";
import { MINIMUM_LABEL_MODULE_MM } from "./printLayout";

type Encoding = {
  symbology: LabelFormat;
  value: string;
  maxWidthMm: number;
  maxHeightMm: number;
};

const maxPreferredModule = 0.64;
const barcodeMinimumHeight = { code39: 6.35, code128: 6.35, ean13: 18.28, gs1_128: 31.75 };

function isMatrix(format: LabelFormat): format is "qr" | "datamatrix" | "gs1_datamatrix" {
  return format === "qr" || format === "datamatrix" || format === "gs1_datamatrix";
}

function imageDimensions(svg: string, { symbology, maxWidthMm, maxHeightMm }: Encoding) {
  const bounds = /^<svg viewBox="0 0 (\d+) (\d+)"/u.exec(svg);
  if (bounds === null) return null;
  const width = Number(bounds[1]);
  const height = Number(bounds[2]);
  const minModule = MINIMUM_LABEL_MODULE_MM[symbology];
  if (isMatrix(symbology)) {
    // BWIPP's matrix rendering at scale 1 uses two drawing units per barcode module.
    const factor = Math.min(maxWidthMm / width, maxHeightMm / height, maxPreferredModule / 2);
    if (factor * 2 < minModule) return null;
    return { widthMm: width * factor, heightMm: height * factor, stretch: false };
  }
  const factor = Math.min(maxWidthMm / width, maxPreferredModule);
  if (factor < minModule) return null;
  const quietZone = symbology === "ean13" ? height / (height - 2) : 1;
  const minimum = Math.max(barcodeMinimumHeight[symbology], width * factor * 0.15) * quietZone;
  if (maxHeightMm < minimum) return null;
  const preferred = Math.max(minimum, height * factor);
  return { widthMm: width * factor, heightMm: Math.min(maxHeightMm, preferred), stretch: true };
}

/** Encodes locally and refuses a sheet cell smaller than the format's production dimensions. */
export async function encodeLabel(input: Encoding) {
  const { symbology, value, maxWidthMm, maxHeightMm } = input;
  if (!(maxWidthMm > 0) || !(maxHeightMm > 0) || value.length > 4_096) return null;
  const text =
    symbology === "gs1_128" || symbology === "gs1_datamatrix" ? gs1PrintText(value) : value;
  if (text === null) return null;
  try {
    const { drawBarcode } = await import("./barcodeDrawing");
    const svg = drawBarcode(symbology, text);
    const dimensions = imageDimensions(svg, input);
    if (dimensions === null) return null;
    const { stretch, widthMm, heightMm } = dimensions;
    const image = stretch ? svg.replace(/^<svg /u, '<svg preserveAspectRatio="none" ') : svg;
    return {
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}`,
      widthMm,
      heightMm,
    };
  } catch {
    return null;
  }
}

export function labelPrintItem(record: LabelRecord, origin: string) {
  const { id, format, source, value, target } = record;
  return {
    id,
    title: target.title,
    subtitle: target.subtitle,
    symbology: format,
    value: source === "internal" ? (physicalLabelScanUrl(origin, value) ?? value) : value,
    humanReadable:
      format === "gs1_128" || format === "gs1_datamatrix" ? (gs1PrintText(value) ?? value) : value,
  };
}
