import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

if (process.env.GITHUB_ACTIONS !== "true" || process.env.BASE_URL !== "https://127.0.0.1:3443") {
  throw new Error("The browser CI server only runs in the isolated GitHub runner profile");
}
const next = spawn(
  "bun",
  ["--no-env-file", "--bun", "next", "start", "--hostname", "127.0.0.1", "--port", "3000"],
  {
    cwd: new URL("../..", import.meta.url),
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  },
);
const server = https.createServer(
  { key: readFileSync(".tls/key.pem"), cert: readFileSync(".tls/cert.pem") },
  (request, response) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: "127.0.0.1:3443", "x-forwarded-proto": "https" },
      },
      (result) => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  },
);
server.listen(3443, "127.0.0.1");
function stop() {
  server.close();
  next.kill("SIGTERM");
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
next.once("exit", (code) => {
  server.close();
  process.exitCode = code ?? 1;
});
