import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";
import { type CBORType, encodeCBOR } from "@levischuck/tiny-cbor";
import { expect } from "vitest";

export interface SyntheticAuthenticator {
  id: string;
  credentialId: Buffer;
  publicKey: KeyObject;
  privateKey: KeyObject;
  counter: number;
}

export interface RegistrationOptions {
  challenge: string;
  rp: { id: string };
  user: { id: string };
}

export function syntheticAuthenticator(): SyntheticAuthenticator {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const credentialId = randomBytes(32);
  return { ...pair, credentialId, id: credentialId.toString("base64url"), counter: 0 };
}

function clientData(type: "webauthn.create" | "webauthn.get", challenge: string, origin: string) {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

function authData(rpId: string, flags: number, counter: number): Buffer {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(counter);
  return Buffer.concat([createHash("sha256").update(rpId).digest(), Buffer.from([flags]), count]);
}

export function registrationResponse(
  authenticator: SyntheticAuthenticator,
  options: RegistrationOptions,
  origin: string,
  verified = true,
) {
  const publicKey = authenticator.publicKey.export({ format: "jwk" });
  expect(publicKey.x).toBeTypeOf("string");
  expect(publicKey.y).toBeTypeOf("string");
  const cose = new Map<number, CBORType>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(publicKey.x ?? "", "base64url")],
    [-3, Buffer.from(publicKey.y ?? "", "base64url")],
  ]);
  const credentialLength = Buffer.alloc(2);
  credentialLength.writeUInt16BE(authenticator.credentialId.length);
  const data = Buffer.concat([
    authData(options.rp.id, 0x41 | (verified ? 0x04 : 0), 0),
    Buffer.alloc(16),
    credentialLength,
    authenticator.credentialId,
    encodeCBOR(cose),
  ]);
  const attestation = encodeCBOR(
    new Map<string, CBORType>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", data],
    ]),
  );
  return {
    id: authenticator.id,
    rawId: authenticator.id,
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData("webauthn.create", options.challenge, origin).toString(
        "base64url",
      ),
      attestationObject: Buffer.from(attestation).toString("base64url"),
      transports: ["internal"],
    },
  };
}

export function authenticationResponse(
  authenticator: SyntheticAuthenticator,
  options: { challenge: string; rpId: string },
  origin: string,
  verified = true,
) {
  authenticator.counter += 1;
  const data = authData(options.rpId, verified ? 0x05 : 0x01, authenticator.counter);
  const client = clientData("webauthn.get", options.challenge, origin);
  const signature = sign(
    "sha256",
    Buffer.concat([data, createHash("sha256").update(client).digest()]),
    { key: authenticator.privateKey, dsaEncoding: "der" },
  );
  return {
    id: authenticator.id,
    rawId: authenticator.id,
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: {
      clientDataJSON: client.toString("base64url"),
      authenticatorData: data.toString("base64url"),
      signature: signature.toString("base64url"),
      userHandle: null,
    },
  };
}

export class AuthCookieJar {
  private readonly values = new Map<string, string>();
  constructor(readonly origin: string) {}
  apply(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const key = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value === "") this.values.delete(key);
      else this.values.set(key, value);
    }
  }
  headers(): Headers {
    return new Headers({
      origin: this.origin,
      "content-type": "application/json",
      cookie: [...this.values].map(([key, value]) => `${key}=${value}`).join("; "),
    });
  }
}

export async function nativeRequest(
  auth: { handler: (request: Request) => Promise<Response> },
  jar: AuthCookieJar,
  path: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const response = await auth.handler(
    new Request(`${jar.origin}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: jar.headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  jar.apply(response);
  return response;
}
