"use client";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { type LegalEntity, legalEntitySchema } from "../contracts";
import { ProfileApiError, profileRequest } from "../ui/api";
import { CommandFeedback, ProfileError } from "../ui/CommandFeedback";
import { useDepartureGuard } from "../ui/useDepartureGuard";
import { useProfileCommand } from "../ui/useProfileApi";
import {
  candidatesSchema,
  type SignedCandidate,
  type VatResult,
  vatResultSchema,
} from "./contracts";
import { useLookupMessages } from "./messages";

const applyLookup = z.strictObject({
  action: z.literal("save_legal_entity"),
  requestId: z.uuid(),
  token: z.string().max(30000),
});
export function CompanyLookupPanel({
  onApplied,
  scope,
}: {
  onApplied: () => void | Promise<void>;
  scope: string;
}) {
  const L = useLookupMessages();
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [list, setList] = useState<SignedCandidate[] | null>(null);
  const [selected, setSelected] = useState<SignedCandidate | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const command = useProfileCommand(
    `${scope}:gleif`,
    applyLookup,
    legalEntitySchema,
    "/api/company-profile",
    (body, signal) =>
      profileRequest("/api/company-lookup", legalEntitySchema, signal, {
        ...body,
        action: "apply",
      }),
  );
  const locked = command.busy || command.command !== null;
  useDepartureGuard(command.command !== null, L.failed);
  async function search() {
    setPending(true);
    setError(false);
    try {
      setList(
        await profileRequest("/api/company-lookup", candidatesSchema, AbortSignal.timeout(20000), {
          action: "search",
          query,
          country,
        }),
      );
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  async function accepted(result: LegalEntity | null) {
    if (!result) return;
    setSelected(null);
    setList(null);
    try {
      await onApplied();
    } catch {
      /* Keep the known acknowledgement visible. */
    }
  }
  return (
    <section className="ph-no-capture ph-block-email space-y-4 rounded-lg border p-4">
      <h3 className="font-medium">{L.title}</h3>
      <p className="text-sm text-muted-foreground">{L.hint}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm" htmlFor="company-lookup-query">
          {L.query}
          <Input
            id="company-lookup-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={pending || locked}
          />
        </label>
        <label className="text-sm" htmlFor="company-lookup-country">
          {L.country}
          <Input
            id="company-lookup-country"
            value={country}
            maxLength={2}
            dir="ltr"
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            disabled={pending || locked}
          />
        </label>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={pending || locked || query.trim().length < 2}
        onClick={() => void search()}
      >
        {pending ? L.busy : L.search}
      </Button>
      {list?.length === 0 && <p role="status">{L.empty}</p>}
      {list &&
        selected === null &&
        list.map((v) => (
          <div
            key={v.lei}
            className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
          >
            <div>
              <bdi>{v.data.legalName}</bdi>
              <p className="text-sm">
                <bdi>
                  {v.data.registeredAddress.city}, {v.data.country}
                </bdi>
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSelected(v);
              }}
            >
              {L.select}
            </Button>
          </div>
        ))}
      {selected && (
        <div className="space-y-3 rounded border p-4">
          <h4>{L.review}</h4>
          <p>
            <bdi>{selected.data.legalName}</bdi>
          </p>
          <p>
            <bdi>{Object.values(selected.data.registeredAddress).filter(Boolean).join(", ")}</bdi>
          </p>
          <p>
            <bdi>
              {selected.data.registerAuthority} {selected.data.registrationNumber}
            </bdi>
          </p>
          <p className="text-xs">
            {L.source}:{" "}
            <a
              className="underline"
              target="_blank"
              rel="noreferrer noopener"
              href={selected.sourceUrl}
            >
              {["GLEIF", selected.lei].join(" · ")}
            </a>{" "}
            · <bdi>{selected.checkedAt}</bdi>
          </p>
          <div className="flex flex-wrap gap-2">
            {!locked && (
              <Button
                type="button"
                disabled={pending}
                onClick={() => {
                  void command
                    .run({
                      action: "save_legal_entity",
                      requestId: crypto.randomUUID(),
                      token: selected.token,
                    })
                    .then(accepted);
                }}
              >
                {L.confirm}
              </Button>
            )}
            {!locked && (
              <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
                {L.cancel}
              </Button>
            )}
          </div>
        </div>
      )}
      <CommandFeedback
        state={command}
        retry={() => {
          void command.retry().then(accepted);
        }}
        discard={command.discard}
        cancel={() => {
          void command.cancel().then(accepted);
        }}
      />
      {error && <p role="alert">{L.failed}</p>}
      <VatCheck />
    </section>
  );
}
function VatCheck() {
  const L = useLookupMessages();
  const [country, setCountry] = useState("DE");
  const [vat, setVat] = useState("");
  const [result, setResult] = useState<VatResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function check() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await profileRequest("/api/company-lookup", vatResultSchema, AbortSignal.timeout(25000), {
          action: "check_vat",
          country,
          vatNumber: vat,
        }),
      );
    } catch (reason) {
      setError(reason instanceof ProfileApiError ? reason.code : "provider_unavailable");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="font-medium">{L.vatTitle}</h3>
      <p className="text-sm text-muted-foreground">{L.vatHint}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm" htmlFor="company-vat-country">
          {L.vatCountry}
          <Input
            id="company-vat-country"
            value={country}
            maxLength={2}
            dir="ltr"
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            disabled={pending}
          />
        </label>
        <label className="text-sm" htmlFor="company-vat-number">
          {L.vatNumber}
          <Input
            id="company-vat-number"
            value={vat}
            dir="ltr"
            onChange={(e) => setVat(e.target.value)}
            disabled={pending}
          />
        </label>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={pending || vat.trim().length < 2}
        onClick={() => void check()}
      >
        {pending ? L.busy : L.check}
      </Button>
      {result && (
        <div role="status">
          <p>{result.valid ? L.valid : L.invalid}</p>
          <p>
            <bdi>
              {result.country} {result.vatNumber} · {result.checkedAt}
            </bdi>
          </p>
          {result.valid && (
            <p>
              <bdi>
                {result.name} {result.address}
              </bdi>
            </p>
          )}
        </div>
      )}
      {error === "provider_unavailable" ? (
        <p role="alert">{L.provider}</p>
      ) : (
        error !== null && <ProfileError code={error} />
      )}
    </div>
  );
}
