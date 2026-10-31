import { createHash } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";
import type { DBAdapter, DBTransactionAdapter, Where } from "better-auth/adapters";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

type AdapterFactory = (options: BetterAuthOptions) => DBAdapter;
interface HashedSessionAdapterOptions {
  revokedField?: string;
}
const protectedAdapters = new WeakSet<DBTransactionAdapter>();

function invalidStorage(): never {
  throw new AppError(ERROR_IDS.AUTH_SESSION_STORAGE_INVALID, "Unsupported session token operation");
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("base64url");
}

function recordToken(tokens: Map<string, string>, value: unknown): void {
  if (typeof value !== "string") invalidStorage();
  tokens.set(hashToken(value), value);
}

function tokenInputs(where: Where[] = [], write?: Record<string, unknown>): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const predicate of where) {
    if (predicate.field !== "token") continue;
    const operator = predicate.operator ?? "eq";
    if (!["eq", "ne", "in", "not_in"].includes(operator)) invalidStorage();
    if (predicate.mode === "insensitive") invalidStorage();
    const values = Array.isArray(predicate.value) ? predicate.value : [predicate.value];
    for (const value of values) recordToken(tokens, value);
  }
  if (write?.token !== undefined) recordToken(tokens, write.token);
  return tokens;
}

function hashWhere(where: Where[] = [], revokedField?: string): Where[] {
  // An OR group must not bypass the appended liveness condition. Native session operations use
  // conjunctions; reject unsupported session filter shapes rather than changing their meaning.
  if (revokedField !== undefined && where.some((predicate) => predicate.connector === "OR"))
    invalidStorage();
  const hashed = where.map((predicate) => {
    if (predicate.field !== "token") return predicate;
    // Validate the predicate before transforming it. Hashes do not preserve lexical ordering.
    tokenInputs([predicate]);
    const value = Array.isArray(predicate.value)
      ? predicate.value.map((entry) => hashToken(String(entry)))
      : hashToken(String(predicate.value));
    return { ...predicate, value };
  });
  return revokedField === undefined ? hashed : [...hashed, { field: revokedField, value: null }];
}

function hashWrite<T extends Record<string, unknown>>(data: T): T {
  if (data.token === undefined) return data;
  if (typeof data.token !== "string") invalidStorage();
  return { ...data, token: hashToken(data.token) };
}

function restoreToken<T>(row: T, inputs: Map<string, string>): T {
  if (row === null || typeof row !== "object" || !("token" in row)) return row;
  const token = typeof row.token === "string" ? (inputs.get(row.token) ?? "") : "";
  return { ...row, token };
}

function protectAdapter<T extends DBTransactionAdapter>(
  adapter: T,
  config: HashedSessionAdapterOptions,
): T {
  if (protectedAdapters.has(adapter)) return adapter;
  protectedAdapters.add(adapter);
  const raw = { ...adapter };
  const methods: DBTransactionAdapter = {
    ...raw,
    create: async (args) => {
      if (args.model !== "session") return raw.create(args);
      const inputs = tokenInputs([], args.data);
      return restoreToken(await raw.create({ ...args, data: hashWrite(args.data) }), inputs);
    },
    findOne: async (args) => {
      if (args.model !== "session") return raw.findOne(args);
      const inputs = tokenInputs(args.where);
      return restoreToken(
        await raw.findOne({ ...args, where: hashWhere(args.where, config.revokedField) }),
        inputs,
      );
    },
    findMany: async (args) => {
      if (args.model !== "session") return raw.findMany(args);
      const inputs = tokenInputs(args.where);
      const rows = await raw.findMany({
        ...args,
        where: hashWhere(args.where, config.revokedField),
      });
      return rows.map((row) => restoreToken(row, inputs));
    },
    update: async (args) => {
      if (args.model !== "session") return raw.update(args);
      const inputs = tokenInputs(args.where, args.update);
      return restoreToken(
        await raw.update({
          ...args,
          where: hashWhere(args.where, config.revokedField),
          update: hashWrite(args.update),
        }),
        inputs,
      );
    },
    updateMany: async (args) =>
      raw.updateMany(
        args.model === "session"
          ? {
              ...args,
              where: hashWhere(args.where, config.revokedField),
              update: hashWrite(args.update),
            }
          : args,
      ),
    count: async (args) =>
      raw.count(
        args.model === "session"
          ? {
              ...args,
              where: hashWhere(args.where, config.revokedField),
            }
          : args,
      ),
    delete: async (args) =>
      raw.delete(
        args.model === "session"
          ? {
              ...args,
              where: hashWhere(args.where, config.revokedField),
            }
          : args,
      ),
    deleteMany: async (args) =>
      raw.deleteMany(
        args.model === "session"
          ? {
              ...args,
              where: hashWhere(args.where, config.revokedField),
            }
          : args,
      ),
    consumeOne: async (args) => {
      if (args.model !== "session") return raw.consumeOne(args);
      const inputs = tokenInputs(args.where);
      return restoreToken(
        await raw.consumeOne({ ...args, where: hashWhere(args.where, config.revokedField) }),
        inputs,
      );
    },
    incrementOne: async (args) => {
      if (args.model !== "session") return raw.incrementOne(args);
      if ("token" in args.increment) invalidStorage();
      const inputs = tokenInputs(args.where, args.set);
      return restoreToken(
        await raw.incrementOne({
          ...args,
          where: hashWhere(args.where, config.revokedField),
          set: args.set ? hashWrite(args.set) : undefined,
        }),
        inputs,
      );
    },
  };
  // Preserve adapter identity so upstream WeakMap-based schema checks still refer to this object.
  Object.assign(adapter, methods);
  if ("transaction" in raw && typeof raw.transaction === "function") {
    const transaction = raw.transaction as DBAdapter["transaction"];
    Object.assign(adapter, {
      transaction: <R>(callback: (tx: DBTransactionAdapter) => Promise<R>) =>
        transaction((tx) => callback(protectAdapter(tx, config))),
    });
  }
  return adapter;
}

/**
 * Raw tokens are restored only from the current caller's write/lookup, never from the database.
 * Device management uses application-owned ID-based endpoints; native token-list APIs are blocked.
 */
export function hashSessionAdapter(
  factory: AdapterFactory,
  config: HashedSessionAdapterOptions = {},
): AdapterFactory {
  return (options) => protectAdapter(factory(options), config);
}
