# Bun runtime compatibility

## Authentication qualification runtime

The application now pins Bun **1.4.4** in `package.json` and the Docker image. The full
PostgreSQL campaign reproduced an oversized WebSocket message closing with authentication
code `4401` on 1.4.2: its built-in `ws` implementation ignored the configured `maxPayload`.
The unchanged six-case WebSocket resource-limit suite passes on 1.4.4, including protocol
code `1009` for oversized messages. This matches the
[official 1.4.4 compatibility fixes](https://bun.sh/blog/bun-v1.4.4#ws-behaves-like-the-npm-package-on-node-js).
Use the pinned runtime for local, CI and deployed authentication qualification. Other projects'
runtime installations need not change. The older compatibility observations below retain
their original version context.

The root package pins Bun through `packageManager`. Use `bun install --frozen-lockfile`,
then the checked-in scripts, which run Next, Vitest and the other CLI tools on Bun.

## Direct dependency exceptions

The CRM keeps two compatibility pins below the latest stable releases checked on
2026-10-29. These are intentional exceptions to the package refresh.

### jsdom 29.1.1

With Bun 1.4.2 on macOS arm64, jsdom 30.1.3 throws
`TypeError: 'addEventListener' called on an object that is not a valid instance of EventTarget`
when registering an error listener on its window. This also prevents Vitest 5.0.5 from
starting its jsdom environment, before any tests are collected.

The same isolated fixture with jsdom 29.1.1 passes both a document/script check and a
Testing Library controlled-form typing, focus and submit check. The failure also reproduces
without Vitest:

```sh
bun -e 'import {JSDOM} from "jsdom"; const dom = new JSDOM("<p>hello</p>", {runScripts: "dangerously", pretendToBeVisual: true}); dom.window.addEventListener("error", () => {}); dom.window.close();'
```

Run this comparison in separate scratch packages when reconsidering the pin. Successful
installation alone does not verify the test environment.

### TypeScript 6.0.3 in the CRM

The latest stable compiler is 7.0.2, but the latest typescript-eslint 8.72.1 supports
`>=4.8.4 <6.1.0`, as declared by its installed and registry peer dependencies and its
[supported-version documentation](https://typescript-eslint.io/users/dependency-versions/).
The typed lint parser uses the TypeScript compiler API.

Under Bun 1.4.2, importing TypeScript 6.0.3 exposes `createProgram`, `createSourceFile`
and `createCompilerHost`. TypeScript 7.0.2's default entry exports version information
without those functions; its replacement APIs use separate unstable entry points. Changing
the version alone would therefore break the parser's existing API calls.

Keep the CRM compiler at 6.0.3 until the typed lint tooling supports the new API. The site
and documentation packages already use the 7.0.2 compiler CLI, which runs under Bun; they
do not use the CRM's typed lint parser. Recheck the peer range, API imports and complete
typecheck/lint suite before removing the CRM pin.

## Next development error reporting

Next 16.4.3's development logger assigns directly to an error's `message` while decoding
module identifiers. Bun 1.4.2 timeout signals produce a `DOMException` whose `message` is
read-only. Reporting that timeout therefore threw `TypeError: Attempted to assign to readonly
property`, hiding the underlying error. This behavior is covered by `nextDevLogger.test.ts`
against both installed Next distributions.

`patches/next@16.4.3.patch` fixes only this logger. Writable errors retain their identity and
existing formatting. Read-only errors get a writable reporting copy that preserves their
name, stack, cause, digest and other own properties. Existing build-error and warning routes
remain in place. The patch does not suppress the original timeout, extend deadlines or change
application workers, requests or production rendering.

Bun applies the patch automatically using the root `patchedDependencies` entry and lockfile.
The files are maintained through the official [Bun patch workflow](https://bun.sh/docs/pm/cli/patch):

```sh
bun patch next@16.4.3
# Edit the prepared package, then verify the regression.
bun run test:unit nextDevLogger.test.ts
bun patch --commit node_modules/next
bun install --frozen-lockfile
```

Commit the patch, package metadata and lockfile together. Containers must copy `patches/`
before installing dependencies. Restart an already-running development server after installing
the fix, since its loaded modules retain the previous logger.

When updating Next, inspect the upstream logger and rerun this regression before removing or
rebasing the patch. Successful error reporting does not establish the cause or resolution of
the separate request timeout that exposed it.
