import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

// Fixed loopback target: this helper cannot proxy a configured remote/provider endpoint.
const server = https.createServer(
  { key: readFileSync(process.argv[2]), cert: readFileSync(process.argv[3]) },
  (request, response) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: request.url,
        method: request.method,
        headers: {
          ...request.headers,
          host: "127.0.0.1:3443",
          "x-forwarded-host": "127.0.0.1:3443",
          "x-forwarded-proto": "https",
        },
      },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(502);
      response.end("upstream unavailable");
    });
    request.pipe(upstream);
  },
);
server.listen(3443, "127.0.0.1");
process.on("SIGTERM", () => server.close());
