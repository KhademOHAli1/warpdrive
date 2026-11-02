import type { Pool } from "pg";
import type { Db } from "@/db/client";
import { err, type Result } from "@/types/result";
import type { AuthorityTransactionSpec } from "./authorityTransactionSpec";

type AuthorityTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type CandidateFailure = "authority_transaction_unavailable" | "authority_commit_outcome_unknown";

// Rejection scaffold only, pending the actual real-PostgreSQL behavioral RED.
export function runAuthorityTransactionCandidate<T, E>(
  _pool: Pool,
  _spec: AuthorityTransactionSpec,
  _signal: AbortSignal,
  _operation: (tx: AuthorityTransaction, signal: AbortSignal) => Promise<Result<T, E>>,
): Promise<Result<T, E | CandidateFailure>> {
  void _pool;
  void _spec;
  void _signal;
  void _operation;
  return Promise.resolve(err("authority_transaction_unavailable"));
}
