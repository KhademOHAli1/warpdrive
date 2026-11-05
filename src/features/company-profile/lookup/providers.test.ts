import { expect, it } from "vitest";
import { checkVies, searchGleif } from "./providers";

const signal = () => AbortSignal.timeout(1000);
it("requests only a fixed GLEIF endpoint and maps bounded identity candidates", async () => {
  let requested = "";
  const transport: typeof fetch = (input) => {
    requested = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(
      Response.json({
        data: [
          {
            id: "12345678901234567890",
            attributes: {
              entity: {
                legalName: { name: "Workshop GmbH" },
                status: "ACTIVE",
                legalAddress: {
                  addressLines: ["Street 1"],
                  city: "Berlin",
                  country: "DE",
                  postalCode: "10115",
                },
                registeredAt: { id: "RA000242" },
                registeredAs: "HRB 1",
              },
              registration: { status: "ISSUED" },
            },
          },
        ],
      }),
    );
  };
  const result = await searchGleif("Workshop", "DE", signal(), transport);
  expect(result.ok).toBe(true);
  expect(requested).toContain("https://api.gleif.org/api/v1/lei-records?");
  if (result.ok)
    expect(result.value[0]?.data).toMatchObject({
      legalName: "Workshop GmbH",
      country: "DE",
      registrationNumber: "HRB 1",
    });
});
it("distinguishes a negative VAT result from provider failure and binds returned identifiers", async () => {
  const xml = (valid: string, vat = "123456789") =>
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><checkVatResponse xmlns="urn:ec.europa.eu:taxud:vies:services:checkVat:types"><countryCode>DE</countryCode><vatNumber>${vat}</vatNumber><requestDate>2026-11-05</requestDate><valid>${valid}</valid><name>Example</name></checkVatResponse></soap:Body></soap:Envelope>`;
  const response =
    (body: string): typeof fetch =>
    () =>
      Promise.resolve(new Response(body));
  expect(await checkVies("DE", "123456789", signal(), response(xml("false")))).toMatchObject({
    ok: true,
    value: { valid: false },
  });
  expect(
    await checkVies("DE", "123456789", signal(), response(xml("true", "987654321"))),
  ).toMatchObject({ ok: false });
  expect(
    await checkVies(
      "DE",
      "123456789",
      signal(),
      response(
        "<soap:Envelope><soap:Body><soap:Fault><faultstring>MS_UNAVAILABLE</faultstring></soap:Fault></soap:Body></soap:Envelope>",
      ),
    ),
  ).toMatchObject({ ok: false });
  expect(await checkVies("US", "123", signal(), response(xml("true")))).toMatchObject({
    ok: false,
    error: { code: "invalid_input" },
  });
});
