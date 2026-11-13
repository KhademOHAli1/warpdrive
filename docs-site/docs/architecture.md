---
title: Architecture
description: "How Warpdrive is built: the stack, the runtime services, the feature-based code layout, and the conventions that hold the codebase together."
---

# Architecture

This page describes the application and the fork's source Compose configuration.
See [Installation](/setup/) for requirements and setup.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js (App Router) with React and TypeScript |
| Database | PostgreSQL, accessed through Drizzle ORM |
| Reads | tRPC with TanStack Query |
| Writes | Next server actions |
| UI | shadcn/ui over Radix primitives, with Tailwind |
| Board | dnd-kit for drag and drop |
| Board state | Zustand, scoped to the board |
| Realtime | Self-hosted WebSocket server plus Postgres `LISTEN`/`NOTIFY` |
| Background jobs | pg-boss |
| Object storage | S3-compatible storage, with MinIO in the source Compose file |
| Email | Gmail API over OAuth, IMAP/SMTP mailbox connectors, and separate SMTP for authentication messages |
| Auth | Better Auth, invitation-only with configured email/password, passkeys or Google/Microsoft/OIDC sign-in; mandatory administrator MFA |
| Runtime and package manager | Bun, version declared in each package |
| Localization | next-intl/use-intl, English/Persian/German, locale-aware shared controls |

Custom fields are stored as JSONB rather than as migrated columns, which is what lets
administrators add fields without a schema change.

## Runtime services

The source Compose file defines these services:

- **`app`** serves the Next.js application.
- **`ws`** is the WebSocket server for realtime updates.
- **`worker`** runs background jobs: mailbox sync, CSV imports, scheduled sends.
- **`postgres`** holds all relational data.
- **`minio`** holds uploaded files.
- **`migrate`** applies application and queue schema migrations with the owner
  connection before dependent services start.
- **`createbuckets`** provisions the MinIO bucket once.

A **Caddy** reverse proxy handles HTTPS for the app, WebSocket service, and
object storage API. Runtime processes use a separate database login without
schema ownership.

The `worker` process handles queued imports, mailbox synchronization, and
scheduled sends. Check its status and logs when these operations stall.

## Realtime

Database changes emit Postgres `NOTIFY` events. The WebSocket server relays them to
connected browsers, which update the board, inbox, notification bell, and presence
indicators in place.

Each browser tab shares a WebSocket connection across subscribed components.
The server tags frames with the channel and a per-channel sequence number.

The source build embeds `NEXT_PUBLIC_WS_URL` in the browser bundle. See
[Installation](/setup/) for the Compose settings.

## Code layout

Code is organized by feature, not by technical layer:

```
src/
  features/<feature>/     implementation, types, constants, validation, tests
  components/ui/          shadcn design-system wrappers
  constants/              named constants, including the error ID registry
  types/                  shared types, to break import cycles
  config/env.ts           validated server configuration
  config/clientEnv.ts     build-time browser configuration
  app/                    Next.js routes
```

Each feature directory holds its own implementation, types, validation, and tests
together. The goal is that understanding one feature does not require opening files
across five directories.

## Conventions

Use these conventions when changing application code:

- **Validate at the boundary.** Parse external data as it enters the application.
  Use schemas for procedure inputs, server-action arguments, provider responses,
  CSV rows, and configuration.
- **Use the configuration modules.** Use `src/config/env.ts` for server configuration
  and `src/config/clientEnv.ts` for browser-safe variables embedded at build time.
- **Handle expected failures explicitly.** Use the shared result type where callers
  need to handle an expected failure, such as a failed mailbox sync in a batch.
- **Stable error IDs.** Use the central registry for application errors that need
  a stable support identifier.
- **Cancellation is threaded through.** Long-running operations take an
  `AbortSignal` and pass it to everything they call, so obsoleted requests and sync
  jobs actually stop instead of piling up.
- **Use the design system.** Start with shared components and preserve keyboard
  navigation, focus handling, and scroll locking.

## Testing

Vitest runs unit and integration tests. Tests usually live alongside the feature.

Database integration tests run migrations against real PostgreSQL and exercise the
resulting schema.

## Contributing

See [Contributing](/contributing/).

## Workflow automation

Workflow editors and runtime code live under `src/features/workflows/`, with
the newer studio and its runtime in `src/features/workflows/v2/`. Live runs use a published workflow version and the
background worker. See [Visual workflows](/features/automations/) for editor
paths and configuration.

## Locale and time boundaries

The app coordinates language and text direction, including dialogs and menus.
Language, calendar, digits, and time zone are independent account preferences.
Preserve canonical API and CSV values and distinguish timed instants from all-day
dates when changing these controls.
