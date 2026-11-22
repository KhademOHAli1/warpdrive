const maxPhotoBytes = 10 * 1024 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

export async function auditFixturePhotoFingerprint(file: File): Promise<string | null> {
  if (file.size < pngSignature.length || file.size > maxPhotoBytes) return null;
  const data = await file.arrayBuffer();
  const bytes = new Uint8Array(data, 0, pngSignature.length);
  const png =
    file.type === "image/png" && pngSignature.every((value, index) => bytes[index] === value);
  const jpeg =
    file.type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}
