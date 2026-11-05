import type { KPI_GRAPH_COMPARE, KPI_GRAPH_COMPUTE } from "./kpiModel";

const SCALE = 10000n;
const MAX = 999999999999999999n;
export class KpiGraphMathError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "KpiGraphMathError";
  }
}
export function graphDecimal(value: string): bigint {
  if (!/^-?\d+(\.\d{1,4})?$/u.test(value)) throw new KpiGraphMathError("graph_invalid_decimal");
  const [whole = "0", fraction = ""] = value.replace(/^-/u, "").split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, "0"));
  return checked(value.startsWith("-") ? -result : result);
}
export function graphNumberText(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(4, "0").replace(/0+$/u, "");
  return `${value < 0n ? "-" : ""}${absolute / SCALE}${fraction.length > 0 ? `.${fraction}` : ""}`;
}
function checked(value: bigint): bigint {
  if (value > MAX || value < -MAX) throw new KpiGraphMathError("graph_overflow");
  return value;
}
function quotient(a: bigint, b: bigint, multiplier = 1n): bigint {
  if (b === 0n) throw new KpiGraphMathError("graph_divide_by_zero");
  return (a * SCALE * multiplier) / b;
}
export function computeGraphNumber(
  operation: (typeof KPI_GRAPH_COMPUTE)[number],
  a: bigint,
  b = 0n,
): bigint {
  let value: bigint;
  switch (operation) {
    case "add":
      value = a + b;
      break;
    case "subtract":
      value = a - b;
      break;
    case "multiply":
      value = (a * b) / SCALE;
      break;
    case "divide":
      value = quotient(a, b);
      break;
    case "percent":
      value = quotient(a, b, 100n);
      break;
    case "min":
      value = a < b ? a : b;
      break;
    case "max":
      value = a > b ? a : b;
      break;
    case "abs":
      value = a < 0n ? -a : a;
      break;
    case "round":
      value = (a < 0n ? -1n : 1n) * (((a < 0n ? -a : a) + SCALE / 2n) / SCALE) * SCALE;
      break;
  }
  return checked(value);
}
export function compareGraphNumbers(
  operator: (typeof KPI_GRAPH_COMPARE)[number],
  a: bigint,
  b: bigint,
): boolean {
  switch (operator) {
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
    case "eq":
      return a === b;
    case "neq":
      return a !== b;
  }
}
