import { afterEach, describe, expect, it } from "vitest";
import { startMailProtocolSmtp } from "@/test/mailProtocolSmtp";
import { buildMime } from "../mime";
import { createSmtpTransport } from "./smtp";

const fixtures: Awaited<ReturnType<typeof startMailProtocolSmtp>>[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

async function setup(options?: Parameters<typeof startMailProtocolSmtp>[0]) {
  const fixture = await startMailProtocolSmtp(options);
  fixtures.push(fixture);
  const config = {
    endpoint: fixture.endpoint,
    username: "owner@mail.test",
    password: "synthetic-password",
    timeouts: { connectionMs: 2000, greetingMs: 2000, socketMs: 400 },
  };
  return { fixture, config, transport: createSmtpTransport(config) };
}

function raw(subject: string) {
  return Buffer.from(
    buildMime({
      from: "owner@mail.test",
      to: ["recipient@mail.test"],
      subject,
      messageId: "<stable-outbox@mail.test>",
      html: `<p>${subject}</p>`,
    }),
  );
}

describe("native SMTP transport", () => {
  it("does not mark a post-auth connection loss during the guard as possible DATA", async () => {
    const { fixture, transport } = await setup();
    const result = await transport.sendRaw({
      from: "owner@mail.test",
      to: ["recipient@mail.test"],
      raw: raw("not sent"),
      signal: new AbortController().signal,
      beforeSubmission: async () => {
        fixture.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 20));
        return true;
      },
    });
    expect(result).toEqual({ ok: false, error: { kind: "connection", retrySafe: true } });
    expect(fixture.received).toHaveLength(0);
  });

  it.each([450, 550] as const)(
    "treats an explicit DATA negative acknowledgement %s as definite rejection",
    async (rejectAfterDataCode) => {
      const { fixture, transport } = await setup({ rejectAfterDataCode });
      expect(
        await transport.sendRaw({
          from: "owner@mail.test",
          to: ["recipient@mail.test"],
          raw: raw("rejected"),
          signal: new AbortController().signal,
        }),
      ).toEqual({
        ok: false,
        error: { kind: "submission_rejected", responseCode: rejectAfterDataCode, retrySafe: true },
      });
      expect(fixture.received).toHaveLength(1);
    },
  );

  it("reports failed AUTH as definitely unsubmitted when sending", async () => {
    const { fixture, config } = await setup();
    const result = await createSmtpTransport({ ...config, password: "wrong-secret" }).sendRaw({
      from: "owner@mail.test",
      to: ["recipient@mail.test"],
      raw: raw("not sent"),
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ ok: false, error: { kind: "authentication", retrySafe: true } });
    expect(fixture.received).toHaveLength(0);
  });

  it("reports malformed input as definitely unsubmitted without authentication", async () => {
    const { fixture, transport } = await setup();
    expect(
      await transport.sendRaw({
        from: "owner@mail.test",
        to: [],
        raw: raw("invalid"),
        signal: new AbortController().signal,
      }),
    ).toEqual({ ok: false, error: { kind: "invalid_request", retrySafe: true } });
    expect(fixture.authenticationAttempts()).toBe(0);
    expect(fixture.received).toHaveLength(0);
  });

  it.each([false, true])(
    "reports failed TLS as definitely unsubmitted (STARTTLS=%s)",
    async (starttls) => {
      const { fixture, config } = await setup({ starttls });
      const transport = createSmtpTransport({
        ...config,
        endpoint: { ...config.endpoint, tls: { ...config.endpoint.tls, servername: "wrong.test" } },
      });
      expect(
        await transport.sendRaw({
          from: "owner@mail.test",
          to: ["recipient@mail.test"],
          raw: raw("TLS rejected"),
          signal: new AbortController().signal,
        }),
      ).toEqual({ ok: false, error: { kind: "tls", retrySafe: true } });
      expect(fixture.authenticationAttempts()).toBe(0);
      expect(fixture.received).toHaveLength(0);
    },
  );

  it("fences a changed connection after authentication and before any DATA", async () => {
    const { transport, fixture } = await setup();
    let checked = false;
    const result = await transport.sendRaw({
      from: "owner@mail.test",
      to: ["recipient@mail.test"],
      raw: raw("fenced"),
      signal: new AbortController().signal,
      beforeSubmission: () => {
        expect(fixture.authenticationAttempts()).toBe(1);
        checked = true;
        return Promise.resolve(false);
      },
    });
    expect(checked).toBe(true);
    expect(result).toEqual({ ok: false, error: { kind: "connection_changed", retrySafe: true } });
    expect(fixture.received).toHaveLength(0);
  });

  it("preserves an abort during the final submission guard without DATA", async () => {
    const { transport, fixture } = await setup();
    const controller = new AbortController();
    await expect(
      transport.sendRaw({
        from: "owner@mail.test",
        to: ["recipient@mail.test"],
        raw: raw("fenced"),
        signal: controller.signal,
        beforeSubmission: () => {
          controller.abort();
          return Promise.resolve(true);
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.received).toHaveLength(0);
  });

  it.each([false, true])(
    "verifies TLS credentials without sending (STARTTLS=%s)",
    async (starttls) => {
      const { transport, fixture } = await setup({ starttls });
      expect(await transport.verify({ signal: new AbortController().signal })).toEqual({
        ok: true,
        value: true,
      });
      expect(fixture.received).toHaveLength(0);
    },
  );

  it.each(["پیشنهاد همکاری", "Angebot für Ihr Unternehmen"])(
    "preserves %s MIME and Message-ID",
    async (subject) => {
      const { transport, fixture } = await setup();
      const source = raw(subject);
      const result = await transport.sendRaw({
        from: "owner@mail.test",
        to: ["recipient@mail.test"],
        raw: source,
        signal: new AbortController().signal,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({
        accepted: ["recipient@mail.test"],
        rejected: [],
        partial: false,
        responseCode: 250,
      });
      expect(fixture.received).toHaveLength(1);
      expect(fixture.received[0]?.toString()).toContain("Message-ID: <stable-outbox@mail.test>");
      expect(fixture.received[0]?.toString()).toContain(Buffer.from(subject).toString("base64"));
    },
  );

  it("reports partial recipient acceptance without claiming delivery", async () => {
    const { transport, fixture } = await setup();
    const result = await transport.sendRaw({
      from: "owner@mail.test",
      to: ["recipient@mail.test", "reject@mail.test"],
      raw: raw("partial"),
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { accepted: ["recipient@mail.test"], rejected: ["reject@mail.test"], partial: true },
    });
    expect(fixture.received).toHaveLength(1);
  });

  it.each([{ dropAfterData: true }, { stallAfterData: true }])(
    "does not retry an uncertain accepted DATA ($dropAfterData/$stallAfterData)",
    async (options) => {
      const { transport, fixture } = await setup(options);
      const result = await transport.sendRaw({
        from: "owner@mail.test",
        to: ["recipient@mail.test"],
        raw: raw("uncertain"),
        signal: new AbortController().signal,
      });
      expect(result).toEqual({
        ok: false,
        error: { kind: "submission_unknown", retrySafe: false },
      });
      expect(fixture.received).toHaveLength(1);
    },
  );

  it("rejects bad credentials without leaking server text or secrets", async () => {
    const { fixture, config } = await setup();
    const result = await createSmtpTransport({ ...config, password: "wrong-secret" }).verify({
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ ok: false, error: { kind: "authentication", retrySafe: true } });
    expect(JSON.stringify(result)).not.toContain("wrong-secret");
    expect(fixture.received).toHaveLength(0);
  });

  it("verifies the approved original hostname, never just the pinned IP", async () => {
    const { config, fixture } = await setup();
    const result = await createSmtpTransport({
      ...config,
      endpoint: { ...config.endpoint, tls: { ...config.endpoint.tls, servername: "wrong.test" } },
    }).verify({ signal: new AbortController().signal });
    expect(result).toMatchObject({ ok: false, error: { kind: "tls" } });
    expect(fixture.authenticationAttempts()).toBe(0);
  });

  it("rejects a missing STARTTLS capability before sending credentials", async () => {
    const { transport, fixture } = await setup({ starttls: true, missingStarttls: true });
    expect(await transport.verify({ signal: new AbortController().signal })).toMatchObject({
      ok: false,
      error: { kind: "tls" },
    });
    expect(fixture.authenticationAttempts()).toBe(0);
  });

  it("preserves cancellation and closes the connection", async () => {
    const { transport, fixture } = await setup({ stallAfterData: true });
    const controller = new AbortController();
    const sending = transport.sendRaw({
      from: "owner@mail.test",
      to: ["recipient@mail.test"],
      raw: raw("abort"),
      signal: controller.signal,
    });
    controller.abort();
    await expect(sending).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.received).toHaveLength(0);
  });

  it("strips folded Bcc headers while retaining Bcc envelope recipients", async () => {
    const { transport, fixture } = await setup();
    const source = Buffer.from(
      raw("privacy")
        .toString()
        .replace(
          "To:",
          "Bcc: hidden@mail.test\r\n\t, hidden2@mail.test\r\nResent-Bcc: hidden3@mail.test\r\nTo:",
        ),
    );
    const result = await transport.sendRaw({
      from: "owner@mail.test",
      to: ["recipient@mail.test", "hidden@mail.test"],
      raw: source,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { accepted: ["recipient@mail.test", "hidden@mail.test"] },
    });
    expect(fixture.received[0]?.toString()).not.toContain("Bcc");
    expect(fixture.received[0]?.toString()).not.toContain("hidden");
  });

  it.each([false, true])(
    "negotiates Unicode envelopes without byte substitution (SMTPUTF8 hidden=%s)",
    async (hideSmtpUtf8) => {
      const { transport, fixture } = await setup({ hideSmtpUtf8 });
      const result = await transport.sendRaw({
        from: "owner@mail.test",
        to: ["آزمایش@mail.test"],
        raw: raw("unicode"),
        signal: new AbortController().signal,
      });
      if (hideSmtpUtf8) {
        expect(result).toEqual({
          ok: false,
          error: { kind: "smtp_utf8_unsupported", retrySafe: true },
        });
        expect(fixture.received).toHaveLength(0);
      } else expect(result).toMatchObject({ ok: true, value: { accepted: ["آزمایش@mail.test"] } });
    },
  );
});
