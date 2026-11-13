---
sidebar_position: 30
title: Contributing
description: "How to contribute to Warpdrive: running it locally, the test-driven workflow, the conventions enforced by lint, and submitting a pull request."
---

# Contributing

Warpdrive is MIT licensed and developed at
[github.com/KhademOHAli1/warpdrive](https://github.com/KhademOHAli1/warpdrive),
with upstream history retained from [sneg55/warpdrive](https://github.com/sneg55/warpdrive).

## Running locally

Use the Bun version declared in the root `package.json`. Start with a dedicated
PostgreSQL database and private S3-compatible bucket. See the
[local backing services](./setup.md#local-development) for a Compose example.

```sh
bun install --frozen-lockfile
bun --no-env-file scripts/deployment/install-web-ui.mjs
cp .env.example .env
```

Configure `.env` for your local services, including the browser-facing app and
WebSocket URLs. Give `MIGRATION_DATABASE_URL` the owner connection and
`DATABASE_URL` a separate runtime login. Run the migration, then apply the
[runtime grants](./setup.md#3-bring-it-up) as the migration owner:

```sh
bun run db:migrate
```

Start each process in a separate terminal from the repository root:

```sh
bun run dev --hostname 127.0.0.1
```

```sh
bun src/entrypoints/worker.ts
```

```sh
bun src/entrypoints/ws.ts
```

Use local mail capture when testing the outbox. For an invitation you can open,
configure an SMTP test service and follow the [administrator bootstrap steps](./setup.md#4-bootstrap-the-first-administrator).
The host-run equivalent of the packaged bootstrap command is `bun run auth:operator`.

## Tests

```sh
bun run test:unit
bun run test:integration
```

Warpdrive is developed test-first. A bugfix begins with a failing test that reproduces
the bug, and a feature begins with a test that expresses the next behavior.

The integration suite starts a PostgreSQL test container and needs a running Docker
daemon. It applies migrations to the test database.

## Conventions

Most conventions are enforced by lint and by hooks rather than by review, so the
fastest way to learn them is to run the linter. The ones that surprise people:

- **Configuration.** Read validated server settings from `src/config/env.ts` and
  build-time browser values from `src/config/clientEnv.ts`.
- **Failures.** Handle expected failures through the shared result type. Use the
  central error ID registry for application errors that need stable identifiers.
- **Interactive controls.** Use the shared components and preserve focus handling
  and keyboard navigation.
- **Code layout.** Keep feature-specific implementation and tests with the feature.
- **Checks.** Run `bun run lint` and `bun run typecheck` for application changes.

See [Architecture](./architecture.md) for the reasoning behind these.

## Pull requests

Open a pull request against `main` from a work branch. Keep the change focused,
include relevant tests and describe what changed, why, and how you verified it.
Link the canonical issue for the work. See the repository's
[delivery tracking guide](https://github.com/KhademOHAli1/warpdrive/blob/main/docs/delivery/tracking.md)
for traceability requirements.

## Documentation

Edit public guides in `docs-site/docs/`. Use the Bun version declared in
`docs-site/package.json` and run these commands from the repository root:

```sh
bun --cwd docs-site install --frozen-lockfile
bun --cwd docs-site run start   # local preview with hot reload
bun --cwd docs-site run build   # production build
```

The build fails on broken page links. Preserve published routes and heading IDs,
and check existing links and fragments in the rendered preview when editing.

Screenshots are captured from a locally seeded demo instance rather than from
production, so that no real customer data can reach a public site. The procedure is
documented in `docs-site/screenshots/capture.md`.

## Interface and documentation changes

Preserve the current application shell and shared component adapters. Check new UI
in Farsi RTL and German LTR, with realistic long labels, light/dark themes, narrow
screens, keyboard navigation, and loading/error/empty states. Use existing locale,
calendar, timezone, digit, and currency helpers. A translated label alone does not
establish a complete localized workflow.

Update the feature guide and relevant operations/architecture notes with the code.
Record current availability separately from proposals and test evidence. The root
`docs/README.md` indexes technical notes; `docs/workflows/status.md` tracks visual
workflow implementation. Never refresh screenshots using real account/customer data.

Report the exact revision and checks you ran. Record application tests,
documentation builds, provider verification, and production deployment separately.
