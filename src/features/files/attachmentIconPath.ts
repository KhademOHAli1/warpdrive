import formats from "./attachmentIconFormats.json";

const filenames = new Map(Object.entries(formats.filenameMap));
const extensions = new Map(Object.entries(formats.extensionMap));
const iconDirectory = "/file-format-icons";

export function attachmentIconPath(filename: string): string {
  const basename = (filename.split(/[\\/]/u).at(-1) ?? "").trim().toLowerCase();
  const namedIcon = filenames.get(basename);
  if (namedIcon !== undefined) return `${iconDirectory}/${namedIcon}.svg`;

  // Walk from the first separator to prefer compound suffixes such as .tar.gz over .gz.
  // The first character can be a dot in a hidden file name, so start after it.
  for (let dot = basename.indexOf(".", 1); dot !== -1; dot = basename.indexOf(".", dot + 1)) {
    const icon = extensions.get(basename.slice(dot + 1));
    if (icon !== undefined) return `${iconDirectory}/${icon}.svg`;
  }

  return `${iconDirectory}/${formats.fallback}.svg`;
}
