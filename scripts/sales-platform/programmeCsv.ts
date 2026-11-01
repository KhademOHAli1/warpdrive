import { err, ok, type Result } from "@/types/result";
import type { ApprovedTask } from "./programmeSchemas";

// The approved CSV includes quoted commas and a BOM, so splitting lines or commas loses its contract.
interface CsvState {
  rows: string[][];
  row: string[];
  cell: string;
  quoted: boolean;
  closed: boolean;
}

function quotedCharacter(input: string, index: number, state: CsvState): number {
  const char = input[index];
  if (char === '"' && input[index + 1] === '"') {
    state.cell += '"';
    return index + 1;
  }
  if (char === '"') {
    state.quoted = false;
    state.closed = true;
  } else state.cell += char;
  return index;
}

function separatedCharacter(input: string, index: number, state: CsvState): number {
  state.row.push(state.cell);
  state.cell = "";
  state.closed = false;
  if (input[index] === ",") return index;
  state.rows.push(state.row);
  state.row = [];
  return input[index] === "\r" && input[index + 1] === "\n" ? index + 1 : index;
}

function rowsFromCsv(text: string): Result<string[][], string> {
  const state: CsvState = { rows: [], row: [], cell: "", quoted: false, closed: false };
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (state.quoted) {
      index = quotedCharacter(input, index, state);
    } else if (char === '"') {
      if (state.cell !== "" || state.closed) return err("Unexpected quote");
      state.quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      index = separatedCharacter(input, index, state);
    } else {
      if (state.closed) return err("Unexpected text after closing quote");
      state.cell += char;
    }
  }
  if (state.quoted) return err("Unclosed quote");
  if (state.cell !== "" || state.row.length > 0 || state.closed)
    state.rows.push([...state.row, state.cell]);
  return ok(state.rows);
}

export function approvedTasksFromCsv(text: string): Result<ApprovedTask[], string> {
  const parsed = rowsFromCsv(text);
  if (!parsed.ok) return parsed;
  const [header, ...rows] = parsed.value;
  if (header === undefined || new Set(header).size !== header.length) return err("Invalid header");
  const idIndex = header.indexOf("task_id");
  const projectIndex = header.indexOf("project_id");
  const dependencyIndex = header.indexOf("depends_on");
  if ([idIndex, projectIndex, dependencyIndex].includes(-1)) return err("Missing required header");
  const tasks: ApprovedTask[] = [];
  for (const row of rows) {
    const id = row[idIndex];
    const projectId = row[projectIndex];
    const dependencies = row[dependencyIndex];
    if (
      row.length !== header.length ||
      id === undefined ||
      projectId === undefined ||
      dependencies === undefined
    )
      return err("Invalid row");
    if (!/^SP-\d{2}\.[1-8]$/.test(id) || !/^SP-\d{2}$/.test(projectId))
      return err("Invalid task identity");
    const dependsOn = dependencies === "" ? [] : dependencies.split(";").map((item) => item.trim());
    if (
      new Set(dependsOn).size !== dependsOn.length ||
      dependsOn.some((item) => !/^SP-\d{2}\.[1-8]$/.test(item))
    )
      return err("Invalid dependencies");
    tasks.push({ id, projectId, dependsOn });
  }
  return ok(tasks);
}
