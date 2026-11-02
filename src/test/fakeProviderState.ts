import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProviderFailure, ProviderInput } from "@/features/integrations/providers/contract";
import { credentialCandidateSchema } from "@/features/integrations/providers/models";
import { err, ok, type Result } from "@/types/result";
import {
  FAKE_ACCESS_TTL_MS,
  type FakeAccount,
  type FakeAttempt,
  type FakeCandidate,
  type FakeCode,
  type FakeCursor,
  type FakeFamily,
  fakeProviderConfigSchema,
} from "./fakeProviderModels";

// Process-local instance sequencing prevents identical seeded fixtures sharing token identities.
// This is contract-test state, never a credential store or proof of database ownership.
let instanceSequence = 0;
export class FakeProviderState {
  readonly accounts: Map<string, FakeAccount>;
  readonly attempts = new Map<string, FakeAttempt>();
  readonly codes = new Map<string, FakeCode>();
  readonly families = new Map<string, FakeFamily>();
  readonly cursors = new Map<string, FakeCursor>();
  private readonly candidates = new Map<
    string,
    { family: FakeFamily; candidate: FakeCandidate; generation: number }
  >();
  private readonly namespace: string;
  private sequence = 0;
  now: number;

  constructor(raw: unknown) {
    const config = fakeProviderConfigSchema.parse(raw);
    this.accounts = new Map(
      config.accounts.map((account) => [account.id, structuredClone(account)]),
    );
    this.now = config.now;
    this.namespace = `${config.label}:${++instanceSequence}`;
  }

  id(kind: string): string {
    const hex = createHash("sha256")
      .update(`${this.namespace}:${kind}:${++this.sequence}`)
      .digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  synthetic(kind: string): string {
    return `synthetic:${this.namespace}:${kind}:${++this.sequence}`;
  }

  advanceTime(ms: number): void {
    this.now = z
      .number()
      .int()
      .nonnegative()
      .parse(this.now + z.number().int().nonnegative().parse(ms));
  }

  issue(family: FakeFamily): FakeCandidate {
    family.accessExpiresAt = this.now + FAKE_ACCESS_TTL_MS;
    const candidate: FakeCandidate = {
      accessToken: this.synthetic(`access:g${family.generation}`),
      refreshToken: this.synthetic(`refresh:g${family.generation}`),
      tokenType: "Bearer",
      expiresAt: family.accessExpiresAt,
      grantedScopes: [...family.scopes],
    };
    this.candidates.set(candidate.accessToken, {
      family,
      candidate: structuredClone(candidate),
      generation: family.generation,
    });
    return candidate;
  }

  bindCredential(raw: unknown): Result<ProviderInput<"check">["credential"], ProviderFailure> {
    const parsed = credentialCandidateSchema.safeParse(raw);
    if (!parsed.success) return err({ code: "invalid_input" });
    const issued = this.candidates.get(parsed.data.accessToken);
    if (
      issued === undefined ||
      issued.family.revoked ||
      issued.family.generation !== issued.generation ||
      issued.family.refreshExpiresAt <= this.now ||
      JSON.stringify(parsed.data) !== JSON.stringify(issued.candidate)
    )
      return err({ code: "authorization_expired" });
    issued.family.boundGeneration = issued.family.generation;
    return ok({ id: issued.family.id, generation: issued.family.generation });
  }

  resolve(
    reference: ProviderInput<"check">["credential"],
    allowExpiredAccess = false,
    includeRevoked = false,
  ): Result<FakeFamily, ProviderFailure> {
    const family = this.families.get(reference.id);
    if (
      family === undefined ||
      reference.generation !== family.generation ||
      reference.generation !== family.boundGeneration ||
      (!includeRevoked && family.revoked) ||
      family.refreshExpiresAt <= this.now ||
      (!allowExpiredAccess && family.accessExpiresAt <= this.now)
    )
      return err({ code: "authorization_expired" });
    return ok(family);
  }
}
