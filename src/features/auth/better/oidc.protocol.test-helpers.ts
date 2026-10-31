import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

type Fault = "state" | "nonce" | "issuer" | "audience" | "signature" | "email" | "pkce";
interface AuthorizationCode {
  challenge: string;
  nonce: string;
  redirect: string;
  fault?: Fault;
}

async function body(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return new URLSearchParams(Buffer.concat(chunks).toString());
}

// This is a deliberately bounded local OIDC fixture. Production issuer admission still requires
// HTTPS; only a direct typed test configuration supplies this ephemeral loopback HTTP issuer.
export async function startOidcProvider(
  profile: { email: string; sub: string },
  options: { mismatchedIssuer?: boolean; initialDiscoveryFailures?: number } = {},
) {
  const key = await generateKeyPair("RS256");
  const otherKey = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(key.publicKey)),
    kid: "qualification",
    alg: "RS256",
    use: "sig",
  };
  const clientId = "qualification-client";
  const clientSecret = "qualification-local-secret";
  const codes = new Map<string, AuthorizationCode>();
  let issuer = "";
  let exchanges = 0;
  let discoveryFailures = options.initialDiscoveryFailures ?? 0;
  const discoveredIssuer = () =>
    options.mismatchedIssuer === true ? `${issuer}/other-issuer` : issuer;
  function authorize(url: URL, response: ServerResponse) {
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    const nonce = url.searchParams.get("nonce") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    if (
      url.searchParams.get("client_id") !== clientId ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      !nonce ||
      !challenge
    ) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "invalid_request" }));
      return;
    }
    const fault = url.searchParams.get("qualification_fault") as Fault | null;
    const code = randomUUID();
    codes.set(code, {
      challenge: fault === "pkce" ? "invalid-challenge" : challenge,
      nonce,
      redirect,
      ...(fault === null ? {} : { fault }),
    });
    const callback = new URL(redirect);
    callback.searchParams.set(
      "state",
      fault === "state" ? "invalid-state" : (url.searchParams.get("state") ?? ""),
    );
    callback.searchParams.set("code", code);
    response.writeHead(302, { location: callback.toString() });
    response.end();
    return;
  }
  async function token(request: IncomingMessage, response: ServerResponse) {
    const data = await body(request);
    const code = data.get("code") ?? "";
    const authorization = codes.get(code);
    codes.delete(code);
    const verifier = createHash("sha256")
      .update(data.get("code_verifier") ?? "")
      .digest("base64url");
    const basic =
      request.headers.authorization ===
      `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    const post = data.get("client_id") === clientId && data.get("client_secret") === clientSecret;
    if (
      authorization === undefined ||
      authorization.challenge !== verifier ||
      authorization.redirect !== data.get("redirect_uri") ||
      (!basic && !post)
    ) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "invalid_grant" }));
      return;
    }
    exchanges += 1;
    const fault = authorization.fault;
    const idToken = await new SignJWT({
      ...profile,
      ...(fault === "email" ? { email: `different-${profile.email}` } : {}),
      name: "OIDC qualification",
      email_verified: true,
      nonce: fault === "nonce" ? "invalid-nonce" : authorization.nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "qualification" })
      .setIssuer(fault === "issuer" ? `${issuer}/invalid` : discoveredIssuer())
      .setAudience(fault === "audience" ? "invalid-client" : clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(fault === "signature" ? otherKey.privateKey : key.privateKey);
    response.end(
      JSON.stringify({
        access_token: randomUUID(),
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
      }),
    );
    return;
  }
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", issuer);
      response.setHeader("content-type", "application/json");
      if (url.pathname === "/.well-known/openid-configuration") {
        if (discoveryFailures > 0) {
          discoveryFailures -= 1;
          response.writeHead(503);
          response.end(JSON.stringify({ error: "temporarily_unavailable" }));
          return;
        }
        response.end(
          JSON.stringify({
            issuer: discoveredIssuer(),
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
            code_challenge_methods_supported: ["S256"],
          }),
        );
        return;
      }
      if (url.pathname === "/jwks") {
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (url.pathname === "/authorize") {
        authorize(url, response);
        return;
      }
      if (url.pathname === "/token") {
        await token(request, response);
        return;
      }
      response.writeHead(404);
      response.end(JSON.stringify({ error: "not_found" }));
    })().catch(() => {
      response.writeHead(500);
      response.end(JSON.stringify({ error: "fixture_error" }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new AppError(ERROR_IDS.AUTH_POLICY_DENIED, "OIDC fixture listener missing");
  issuer = `http://127.0.0.1:${address.port}`;
  return {
    issuer,
    clientId,
    clientSecret,
    exchanges: () => exchanges,
    authorize: async (authorization: URL, fault?: Fault): Promise<URL> => {
      const url = new URL(authorization);
      if (fault !== undefined) url.searchParams.set("qualification_fault", fault);
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      const location = response.headers.get("location");
      if (response.status !== 302 || location === null)
        throw new AppError(ERROR_IDS.AUTH_POLICY_DENIED, "OIDC fixture authorization failed");
      return new URL(location);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}
