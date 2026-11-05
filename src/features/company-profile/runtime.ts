import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { type Db, db } from "@/db/client";
import { enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { MAX_COMPANY_ASSET_BYTES } from "./assetSanitizer";
import { CompanyAssetService } from "./assetService";
import { MinioCompanyAssetStorage } from "./assetStorage";
import { cropSchema } from "./contracts";
import { companyBody, companyCsrf, companyResult } from "./http";
import { companyFailure } from "./policy";
import { CompanyService } from "./service";

type Run = (
  services: { company: CompanyService; assets: CompanyAssetService; actor: PermSetUser; tx: Db },
  signal: AbortSignal,
) => Promise<Response>;
export async function companyAuthorized(
  request: Request,
  mutation: boolean,
  multipart: boolean,
  run: Run,
) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  try {
    if (mutation && !companyCsrf(request, multipart))
      return companyResult({ ok: false, error: companyFailure("forbidden") });
    const initial = await resolveWorkflowSession(db, request.headers, signal, {
      requireFresh: mutation,
    });
    if (!initial)
      return companyResult({
        ok: false,
        error: companyFailure(mutation ? "fresh_auth_required" : "unauthorized"),
      });
    if (
      !(await enforceAuthRateLimit(
        db,
        request.headers,
        mutation ? "/company-profile" : "/snapshot",
        initial.user.id,
        signal,
      ))
    )
      return companyResult({ ok: false, error: companyFailure("rate_limited") });
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      const current = async () => {
        const session = await resolveWorkflowSession(tx, request.headers, signal, {
          requireFresh: mutation,
        });
        const actor = session ? await hydrateActor(tx, session.user.id, signal) : null;
        if (!actor || actor.id !== initial.user.id)
          throw new AppError(ERROR_IDS.COMPANY_DENIED, "Company session changed");
        return actor;
      };
      const actor = await current();
      const response = await run(
        {
          company: new CompanyService(tx, signal),
          assets: new CompanyAssetService(tx, new MinioCompanyAssetStorage(), signal),
          actor,
          tx,
        },
        signal,
      );
      const live = await current();
      if (
        live.type !== actor.type ||
        [...live.flags].sort().join() !== [...actor.flags].sort().join()
      )
        throw new AppError(ERROR_IDS.COMPANY_DENIED, "Company authority changed");
      return response;
    });
  } catch (cause) {
    signal.throwIfAborted();
    if (cause instanceof AppError && cause.id === ERROR_IDS.COMPANY_DENIED)
      return companyResult({ ok: false, error: companyFailure("forbidden") });
    // No provider payload, contact, legal, tax or banking values enter logs/responses.
    return companyResult({ ok: false, error: companyFailure("write_failed") });
  }
}
export function companyGet(request: Request, path: string[]): Promise<Response> {
  return companyAuthorized(request, false, false, async ({ company, assets, actor }) => {
    if (path.length === 1 && path[0] === "overview")
      return companyResult(await company.overview(actor), request);
    if (path.length === 2 && path[0] === "operation" && z.uuid().safeParse(path[1]).success) {
      const id = path[1] ?? "";
      const command = await company.operation(actor, id);
      return companyResult(
        command.ok || command.error.code !== "not_found"
          ? command
          : await assets.operation(actor, id),
        request,
      );
    }
    if (path.length === 2 && path[0] === "assets" && z.uuid().safeParse(path[1]).success) {
      const result = await assets.read(actor, path[1] ?? "");
      return result.ok
        ? new Response(new Uint8Array(result.value), {
            headers: {
              "Content-Type": "image/png",
              "Content-Length": String(result.value.length),
              "Content-Disposition": "inline",
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; sandbox",
              "Referrer-Policy": "no-referrer",
            },
          })
        : companyResult(result);
    }
    return companyResult({ ok: false, error: companyFailure("not_found") });
  });
}
function parseUploadCrop(value: FormDataEntryValue | null) {
  if (value === null) return { ok: true, crop: undefined } as const;
  if (typeof value !== "string") return { ok: false } as const;
  try {
    const parsed = cropSchema.safeParse(JSON.parse(value));
    return parsed.success ? ({ ok: true, crop: parsed.data } as const) : ({ ok: false } as const);
  } catch {
    return { ok: false } as const;
  }
}
export function companyPost(request: Request, path: string[]): Promise<Response> {
  const upload = path.length === 1 && path[0] === "assets";
  return companyAuthorized(request, true, upload, async ({ company, assets, actor }, signal) => {
    if (!upload && path.length !== 0)
      return companyResult({ ok: false, error: companyFailure("not_found") });
    const body = await companyBody(
      request,
      upload ? MAX_COMPANY_ASSET_BYTES + 64 * 1024 : 128 * 1024,
      signal,
    );
    if (!body.ok) return companyResult(body);
    if (!upload) {
      let input: unknown;
      try {
        input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.value));
      } catch {
        return companyResult({ ok: false, error: companyFailure("invalid_input") });
      }
      return companyResult(await company.execute(actor, input));
    }
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(body.value), {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData();
    } catch {
      return companyResult({ ok: false, error: companyFailure("invalid_input") });
    }
    if (
      [...form.keys()].some((key) => !["requestId", "slot", "file", "crop"].includes(key)) ||
      [...new Set(form.keys())].some((key) => form.getAll(key).length !== 1)
    )
      return companyResult({ ok: false, error: companyFailure("invalid_input") });
    const requestId = form.get("requestId"),
      slot = form.get("slot"),
      file = form.get("file"),
      rawCrop = form.get("crop");
    if (
      typeof requestId !== "string" ||
      (slot !== "icon" && slot !== "logo") ||
      !(file instanceof File) ||
      file.size > MAX_COMPANY_ASSET_BYTES
    )
      return companyResult({ ok: false, error: companyFailure("invalid_input") });
    const crop = parseUploadCrop(rawCrop);
    if (!crop.ok) return companyResult({ ok: false, error: companyFailure("asset_invalid") });
    return companyResult(
      await assets.upload(actor, requestId, slot, Buffer.from(await file.arrayBuffer()), crop.crop),
    );
  });
}
