import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import type { CompanyFailure } from "../contracts";
import { legalEntityDataSchema } from "../contracts";
import { companyFailure } from "../policy";
import type { Candidate, VatResult } from "./contracts";

const fail = () => err(companyFailure("provider_unavailable"));
async function bounded(response: Response, signal: AbortSignal): Promise<string | null> {
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 256000) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(part.value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
const str = z.string().max(1000);
const record = z.object({
  id: z.string().regex(/^[A-Z0-9]{20}$/),
  attributes: z.object({
    entity: z.object({
      legalName: z.object({ name: str }),
      status: str,
      legalAddress: z.object({
        addressLines: z.array(str).max(10),
        city: str,
        country: z.string().regex(/^[A-Z]{2}$/),
        postalCode: str.nullable().optional(),
        region: str.nullable().optional(),
      }),
      registeredAt: z.object({ id: str.nullable().optional() }).optional(),
      registeredAs: str.nullable().optional(),
    }),
    registration: z.object({ status: str }),
  }),
});
/** Only GLEIF LEI holders are covered. A result is a proposal, never automatic verification of the user. */
export async function searchGleif(
  query: string,
  country: string,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<Result<Candidate[], CompanyFailure>> {
  if (query.trim().length < 2 || query.length > 160 || !/^$|^[A-Z]{2}$/.test(country))
    return err(companyFailure("invalid_input"));
  try {
    const url = new URL("https://api.gleif.org/api/v1/lei-records");
    url.searchParams.set("filter[entity.legalName]", query.trim());
    url.searchParams.set("page[size]", "8");
    if (country) url.searchParams.set("filter[entity.legalAddress.country]", country);
    const raw = await bounded(
      await transport(url, {
        signal,
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "application/vnd.api+json" },
      }),
      signal,
    );
    if (raw === null) return fail();
    const parsed = z.object({ data: z.array(record).max(8) }).safeParse(JSON.parse(raw));
    if (!parsed.success) return fail();
    const checkedAt = new Date().toISOString();
    const candidates: Candidate[] = [];
    for (const row of parsed.data.data) {
      const e = row.attributes.entity;
      if (e.status !== "ACTIVE" || row.attributes.registration.status !== "ISSUED") continue;
      const a = e.legalAddress;
      const sourceUrl = `https://api.gleif.org/api/v1/lei-records/${row.id}`;
      const data = legalEntityDataSchema.safeParse({
        legalName: e.legalName.name,
        country: a.country,
        registeredAddress: {
          line1: a.addressLines[0] ?? "",
          line2: a.addressLines.slice(1).join(", "),
          city: a.city,
          state: a.region ?? "",
          postalCode: a.postalCode ?? "",
          country: a.country,
        },
        registrationNumber: e.registeredAs ?? "",
        registerAuthority: e.registeredAt?.id ?? "",
        source: { kind: "registry", url: sourceUrl, recordId: row.id },
      });
      if (!data.success) return fail();
      candidates.push({ lei: row.id, data: data.data, checkedAt, sourceUrl });
    }
    return ok(candidates);
  } catch {
    signal.throwIfAborted();
    return fail();
  }
}
const countries = new Set(
  "AT BE BG HR CY CZ DE DK EE EL ES FI FR HU IE IT LT LU LV MT NL PL PT RO SE SI SK XI".split(" "),
);
const leaf = z.union([z.string(), z.number()]).transform(String);
const vatResponse = z.object({
  countryCode: leaf,
  vatNumber: leaf,
  requestDate: leaf,
  valid: z.enum(["true", "false", "1", "0"]),
  name: leaf.optional(),
  address: leaf.optional(),
});
/** VIES checks a VAT identifier at this time; it does not establish invoice tax treatment. */
export async function checkVies(
  country: string,
  vatNumber: string,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<Result<VatResult, CompanyFailure>> {
  const number = vatNumber.replaceAll(" ", "").toUpperCase();
  if (!countries.has(country) || !/^[0-9A-Z][0-9A-Z+*.]{1,11}$/.test(number))
    return err(companyFailure("invalid_input"));
  try {
    const body = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><checkVat xmlns="urn:ec.europa.eu:taxud:vies:services:checkVat:types"><countryCode>${country}</countryCode><vatNumber>${number}</vatNumber></checkVat></soap:Body></soap:Envelope>`;
    const raw = await bounded(
      await transport("https://ec.europa.eu/taxation_customs/vies/services/checkVatService", {
        method: "POST",
        body,
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
        signal,
        redirect: "error",
        cache: "no-store",
      }),
      signal,
    );
    if (raw === null || /<!DOCTYPE|<!ENTITY/i.test(raw)) return fail();
    const decoded: unknown = new XMLParser({
      removeNSPrefix: true,
      parseTagValue: false,
      ignoreAttributes: true,
      processEntities: false,
    }).parse(raw);
    const soap = z
      .object({ Envelope: z.object({ Body: z.object({ checkVatResponse: vatResponse }) }) })
      .safeParse(decoded);
    if (!soap.success) return fail();
    const v = soap.data.Envelope.Body.checkVatResponse;
    if (v.countryCode !== country || v.vatNumber !== number) return fail();
    return ok({
      country,
      vatNumber: number,
      valid: v.valid === "true" || v.valid === "1",
      name: v.name ?? "",
      address: v.address ?? "",
      checkedAt: new Date().toISOString(),
      requestDate: v.requestDate,
    });
  } catch {
    signal.throwIfAborted();
    return fail();
  }
}
