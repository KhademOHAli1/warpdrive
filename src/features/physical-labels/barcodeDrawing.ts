import {
  code39,
  code128,
  datamatrix,
  drawingSVG,
  ean13,
  gs1_128,
  gs1datamatrix,
  qrcode,
} from "@bwip-js/generic";
import type { LabelFormat } from "./formats";

const encoders = {
  qr: qrcode,
  code128,
  code39,
  ean13,
  datamatrix,
  gs1_128,
  gs1_datamatrix: gs1datamatrix,
};

const encoderNames: Partial<Record<LabelFormat, string>> = {
  qr: "qrcode",
  gs1_128: "gs1-128",
  gs1_datamatrix: "gs1datamatrix",
};

const protection = {
  qr: { left: 8, right: 8, top: 8, bottom: 8 },
  datamatrix: { left: 2, right: 2, top: 2, bottom: 2 },
  gs1_datamatrix: { left: 2, right: 2, top: 2, bottom: 2 },
  code128: { left: 10, right: 10, top: 1, bottom: 1 },
  code39: { left: 10, right: 10, top: 1, bottom: 1 },
  ean13: { left: 11, right: 7, top: 1, bottom: 1 },
  gs1_128: { left: 10, right: 10, top: 1, bottom: 1 },
} satisfies Record<LabelFormat, { left: number; right: number; top: number; bottom: number }>;

export function drawBarcode(symbology: LabelFormat, value: string): string {
  const { left, right, top, bottom } = protection[symbology];
  const options = {
    bcid: encoderNames[symbology] ?? symbology,
    text: value,
    scale: 1,
    includetext: false,
    parse: symbology === "gs1_128" || symbology === "gs1_datamatrix",
    paddingleft: left,
    paddingright: right,
    paddingtop: top,
    paddingbottom: bottom,
  };
  return encoders[symbology](options, drawingSVG());
}
