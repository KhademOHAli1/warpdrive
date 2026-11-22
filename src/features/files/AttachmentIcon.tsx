import Image from "next/image";
import { attachmentIconPath } from "./attachmentIconPath";

export function AttachmentIcon({ filename, size = 24 }: { filename: string; size?: number }) {
  return (
    <Image
      src={attachmentIconPath(filename)}
      width={size}
      height={size}
      alt=""
      className="shrink-0"
      unoptimized
    />
  );
}
