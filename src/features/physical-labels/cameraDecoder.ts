import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";
import type { ScanInput } from "./contracts";
import type { LabelFormat } from "./formats";

const supported = new Map<BarcodeFormat, LabelFormat>([
  [BarcodeFormat.QR_CODE, "qr"],
  [BarcodeFormat.CODE_128, "code128"],
  [BarcodeFormat.CODE_39, "code39"],
  [BarcodeFormat.EAN_13, "ean13"],
  [BarcodeFormat.DATA_MATRIX, "datamatrix"],
]);

export function createCameraDecoder() {
  const reader = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [...supported.keys()]);
  hints.set(DecodeHintType.ASSUME_GS1, true);
  reader.setHints(hints);

  return (frame: ImageData): ScanInput | null => {
    const grayscale = new Uint8ClampedArray(frame.width * frame.height);
    for (let offset = 0; offset < grayscale.length; offset += 1) {
      const pixel = offset * 4;
      grayscale[offset] =
        (77 * (frame.data[pixel] ?? 0) +
          150 * (frame.data[pixel + 1] ?? 0) +
          29 * (frame.data[pixel + 2] ?? 0)) >>
        8;
    }
    const bitmap = new BinaryBitmap(
      new HybridBinarizer(new RGBLuminanceSource(grayscale, frame.width, frame.height)),
    );
    try {
      const decoded = reader.decodeWithState(bitmap);
      const format = supported.get(decoded.getBarcodeFormat());
      const value = decoded.getText();
      if (format === "code128" && value.startsWith("]C1")) return { value, format: "gs1_128" };
      if (format === "datamatrix" && value.startsWith("\x1D"))
        return { value: value.slice(1), format: "gs1_datamatrix" };
      return format === undefined ? null : { value, format };
    } catch {
      return null;
    }
  };
}
