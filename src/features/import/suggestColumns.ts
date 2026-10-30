import type { ImportSource } from "@/constants/importSources";
import type { CustomFieldDef } from "@/types/customFields";
import type { EligibleField } from "./eligibleFields";
import { type MappableEntity, primaryEntityOf, qualifiedFieldLabel } from "./importFields";
import { PIPEDRIVE_HEADER_PREFIX_ENTITIES, PIPEDRIVE_SYNONYMS } from "./pipedriveSynonyms";
import type { ColumnChoice, ImportTarget } from "./wizardState";

const PREFIX_PATTERN = /^([a-z]+)\s*-\s*(.+)$/;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

interface ParsedHeader {
  text: string;
  prefix: MappableEntity | null | undefined;
}

function parseHeader(header: string, source: ImportSource): ParsedHeader {
  const text = normalize(header);
  if (source !== "pipedrive") return { text, prefix: undefined };
  const match = PREFIX_PATTERN.exec(text);
  const entity = match?.[1];
  if (match === null || entity === undefined || !(entity in PIPEDRIVE_HEADER_PREFIX_ENTITIES)) {
    return { text, prefix: undefined };
  }
  return { text: match[2] ?? "", prefix: PIPEDRIVE_HEADER_PREFIX_ENTITIES[entity] };
}

function standardChoice(entity: MappableEntity, field: string): ColumnChoice {
  return { entity, field, isCustom: false, key: "" };
}

export function suggestColumns(
  headers: readonly string[],
  target: ImportTarget,
  source: ImportSource,
  eligible: readonly EligibleField[],
  defs: readonly CustomFieldDef[] = [],
): Record<string, ColumnChoice> {
  const primary = primaryEntityOf(target);
  const offered = new Set(eligible.map((f) => `${f.entity}:${f.field}`));
  const taken = new Set<string>();

  interface Match {
    slot: string;
    choice: ColumnChoice;
  }

  function fromSynonym({ text, prefix }: ParsedHeader): Match | null {
    if (source !== "pipedrive") return null;
    const table = PIPEDRIVE_SYNONYMS[prefix ?? primary];
    const hit = table?.[text];
    if (hit === undefined || !offered.has(`${hit.entity}:${hit.field}`)) return null;
    return { slot: `${hit.entity}:${hit.field}`, choice: standardChoice(hit.entity, hit.field) };
  }

  function fromLabel({ text, prefix }: ParsedHeader): Match | null {
    const hit = eligible.find((f) => {
      if (prefix !== undefined && f.entity !== prefix) return false;
      const labels = [normalize(f.label)];
      if (prefix === undefined) labels.push(normalize(qualifiedFieldLabel(f.entity, f.label)));
      return labels.includes(text);
    });
    if (hit === undefined) return null;
    return { slot: `${hit.entity}:${hit.field}`, choice: standardChoice(hit.entity, hit.field) };
  }

  function fromCustom({ text, prefix }: ParsedHeader): Match | null {
    if (prefix !== undefined && prefix !== primary) return null;
    const hit = defs.find((d) => normalize(d.name) === text);
    if (hit === undefined) return null;
    return {
      slot: `c:${hit.key}`,
      choice: { entity: primary, field: "", isCustom: true, key: hit.key },
    };
  }

  function suggest(parsed: ParsedHeader): ColumnChoice | null {
    if (parsed.prefix === null) return null;
    const match = fromSynonym(parsed) ?? fromLabel(parsed) ?? fromCustom(parsed);
    if (match === null || taken.has(match.slot)) return null;
    taken.add(match.slot);
    return match.choice;
  }

  const out: Record<string, ColumnChoice> = {};
  for (const header of headers) {
    out[header] = suggest(parseHeader(header, source)) ?? standardChoice(primary, "");
  }
  return out;
}
