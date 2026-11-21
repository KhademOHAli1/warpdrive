import { crc32, inflateRawSync } from "node:zlib";

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const DESCRIPTOR = 0x08074b50;
const MAX_ENTRIES = 256;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const DESCRIPTOR_FLAG = 0x08;
const ALLOWED_FLAGS = 0x080e;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

type Directory = { offset: number; end: number; entries: number };
type Entry = {
  path: string;
  name: Buffer;
  flags: number;
  method: number;
  checksum: number;
  compressed: number;
  expanded: number;
  offset: number;
  next: number;
};

function readDirectory(bytes: Buffer): Directory | null {
  const start = bytes.length - 22;
  const earliest = Math.max(0, start - 65_535);
  for (let end = start; end >= earliest; end--) {
    if (bytes.readUInt32LE(end) !== END || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length)
      continue;
    const entries = bytes.readUInt16LE(end + 10);
    const offset = bytes.readUInt32LE(end + 16);
    if (bytes.readUInt32LE(end + 4) !== 0 || bytes.readUInt16LE(end + 8) !== entries) return null;
    if (entries === 0 || entries > MAX_ENTRIES || offset + bytes.readUInt32LE(end + 12) !== end)
      return null;
    return { offset, entries, end };
  }
  return null;
}

function safePath(name: Buffer): string | null {
  try {
    const path = utf8.decode(name).normalize("NFKC");
    if (/[\\:<>|?*"\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(path)) return null;
    const parts = (path.endsWith("/") ? path.slice(0, -1) : path).split("/");
    return parts.every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        part.trim() === part &&
        !part.endsWith(".") &&
        !WINDOWS_DEVICE.test(part),
    )
      ? path
      : null;
  } catch {
    return null;
  }
}

function isRegularZipEntry(bytes: Buffer, cursor: number, path: string) {
  const platform = bytes[cursor + 5];
  if (platform !== 3 && platform !== 19) return true;
  const unixType = bytes.readUInt16LE(cursor + 40) & 0xf000;
  return unixType === 0 || unixType === (path.endsWith("/") ? 0x4000 : 0x8000);
}

function readEntry(bytes: Buffer, cursor: number, end: number): Entry | null {
  if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== CENTRAL) return null;
  const names = bytes.readUInt16LE(cursor + 28);
  const next =
    cursor + 46 + names + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  if (names === 0 || names > 512 || next > end || bytes.readUInt16LE(cursor + 34) !== 0)
    return null;
  const name = bytes.subarray(cursor + 46, cursor + 46 + names);
  const path = safePath(name);
  if (path === null || !isRegularZipEntry(bytes, cursor, path)) return null;

  const flags = bytes.readUInt16LE(cursor + 8);
  const method = bytes.readUInt16LE(cursor + 10);
  const expanded = bytes.readUInt32LE(cursor + 24);
  if (
    (flags & ~ALLOWED_FLAGS) !== 0 ||
    (method !== 0 && method !== 8) ||
    expanded > MAX_ENTRY_BYTES
  )
    return null;
  if (path.endsWith("/") && expanded !== 0) return null;

  return {
    path,
    name,
    flags,
    method,
    checksum: bytes.readUInt32LE(cursor + 16),
    compressed: bytes.readUInt32LE(cursor + 20),
    expanded,
    offset: bytes.readUInt32LE(cursor + 42),
    next,
  };
}

function readEntries(bytes: Buffer, directory: Directory): Entry[] | null {
  const names = new Set<string>();
  const entries: Entry[] = [];
  let cursor = directory.offset;
  let expanded = 0;
  for (let index = 0; index < directory.entries; index++) {
    const entry = readEntry(bytes, cursor, directory.end);
    if (entry === null) return null;
    const key = entry.path.replace(/\/$/, "").toUpperCase();
    expanded += entry.expanded;
    if (names.has(key) || expanded > MAX_EXPANDED_BYTES) return null;
    names.add(key);
    entries.push(entry);
    cursor = entry.next;
  }
  return cursor === directory.end ? entries.sort((a, b) => a.offset - b.offset) : null;
}

function localNumbersMatch(bytes: Buffer, entry: Entry) {
  return (
    bytes.readUInt32LE(entry.offset + 14) === entry.checksum &&
    bytes.readUInt32LE(entry.offset + 18) === entry.compressed &&
    bytes.readUInt32LE(entry.offset + 22) === entry.expanded
  );
}

function descriptorMatches(bytes: Buffer, offset: number, end: number, entry: Entry) {
  // The descriptor's signature is optional. A CRC can also equal the signature,
  // so distinguish the two legal encodings by the record length.
  const length = end - offset;
  if (length !== 12 && length !== 16) return false;
  if (length === 16 && bytes.readUInt32LE(offset) !== DESCRIPTOR) return false;
  const start = length === 16 ? offset + 4 : offset;
  return (
    bytes.readUInt32LE(start) === entry.checksum &&
    bytes.readUInt32LE(start + 4) === entry.compressed &&
    bytes.readUInt32LE(start + 8) === entry.expanded
  );
}

function localData(bytes: Buffer, entry: Entry, end: number): Buffer | null {
  const { offset, flags, method } = entry;
  if (offset + 30 > end || bytes.readUInt32LE(offset) !== LOCAL) return null;
  if (bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method)
    return null;
  const nameEnd = offset + 30 + bytes.readUInt16LE(offset + 26);
  const dataStart = nameEnd + bytes.readUInt16LE(offset + 28);
  const dataEnd = dataStart + entry.compressed;
  if (dataEnd > end || !entry.name.equals(bytes.subarray(offset + 30, nameEnd))) return null;
  if ((flags & DESCRIPTOR_FLAG) !== 0) {
    if (!descriptorMatches(bytes, dataEnd, end, entry)) return null;
  } else if (dataEnd !== end || !localNumbersMatch(bytes, entry)) {
    return null;
  }
  return bytes.subarray(dataStart, dataEnd);
}

function expand(data: Buffer, entry: Entry): Buffer | null {
  try {
    const bytes =
      entry.method === 0
        ? data
        : inflateRawSync(data, {
            maxOutputLength: Math.max(1, entry.expanded),
          });
    return bytes.length === entry.expanded && crc32(bytes) === entry.checksum ? bytes : null;
  } catch {
    return null;
  }
}

function fabricationRole(path: string, bytes: Buffer): "gerber" | "drill" | null {
  // KiCad and other exports include Excellon/XNC and Gerber drill files.
  const prefix = bytes.subarray(0, 8192).toString("utf8");
  if (/^[ \t]*M48[ \t]*(?:;[^\r\n]*)?\r?$/m.test(prefix)) return "drill";
  const format = /%(?:FS[A-Z0-9]+|MO(?:MM|IN))\*%/.test(prefix);
  if (!format) return null;
  if (
    /\.(?:drl|xnc|ncd)$/i.test(path) ||
    /TF\.FileFunction,(?:NonPlated|Plated|Drill)/i.test(prefix)
  )
    return "drill";
  return "gerber";
}

/** Read bounded ordinary ZIP records without extracting any file to disk. */
export function validReleaseArchive(
  bytes: Buffer,
  requireFabrication: boolean,
  signal: AbortSignal,
): boolean {
  const directory = readDirectory(bytes);
  if (directory === null) return false;
  const entries = readEntries(bytes, directory);
  if (entries === null || entries[0]?.offset !== 0) return false;
  const roles = new Set<"gerber" | "drill">();
  for (const [index, entry] of entries.entries()) {
    signal.throwIfAborted();
    const data = localData(bytes, entry, entries[index + 1]?.offset ?? directory.offset);
    if (data === null) return false;
    const expanded = expand(data, entry);
    if (expanded === null) return false;
    if (!requireFabrication || entry.path.endsWith("/")) continue;
    const role = fabricationRole(entry.path, expanded);
    if (role !== null) roles.add(role);
  }
  return !requireFabrication || roles.size === 2;
}
