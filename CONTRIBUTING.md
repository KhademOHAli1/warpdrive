# Contributing to Warpdrive

Welcome. Help with CRM behavior, accessibility, Persian and RTL usability, German and
English wording, documentation, tests and reproducible bug reports is valuable.
This maintained fork preserves [upstream Warpdrive](https://github.com/sneg55/warpdrive)
and its MIT attribution.

## Find a useful first change

- Search the [public issues](https://github.com/KhademOHAli1/warpdrive/issues) before
  opening another report.
- Look for [good first issues](https://github.com/KhademOHAli1/warpdrive/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
  and [help wanted](https://github.com/KhademOHAli1/warpdrive/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22).
- Use [Discussions](https://github.com/KhademOHAli1/warpdrive/discussions) for questions
  and early feature ideas. For a larger change, agree on a bounded outcome in an issue
  before implementing it.
- A clear reproduction, a documentation correction or an accessibility finding is a
  contribution. You do not need a production installation or provider credentials.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). For a suspected vulnerability,
use [private vulnerability reporting](https://github.com/KhademOHAli1/warpdrive/security/advisories/new)
and the [security policy](SECURITY.md), rather than a public issue or pull request.

## Develop locally

Follow the [README quickstart](README.md#quickstart-local-development). Use the Bun version
declared in the package you change; the app, marketing site and documentation site have
their own pins and lockfiles. Preserve the appropriate `bun.lock` and use frozen installs.

Use synthetic data and a dedicated development database. Keep `.env` files, credentials,
mailbox contents, customer records and production logs out of commits and screenshots.
Integration tests use disposable PostgreSQL through Docker/Testcontainers; migrations
must never be tested against a customer database.

Run checks related to your change, for example:

```sh
# Replace the selector with an affected test file.
bun run test:unit src/features/example/example.test.ts
bun run typecheck
bun run lint
```

For persistence changes, run the relevant integration cases. GitHub CI runs the full
checks. In the pull request, record the commands and results you actually obtained,
including checks you could not run and why. External-provider behavior needs its own
evidence; a mocked response does not establish it.

## Keep changes reviewable

- Use a small branch in your fork and open a pull request against this repository's
  `main`. Keep each request focused on one usable outcome or fix.
- Preserve existing behavior outside that outcome. Add a regression for a behavior fix;
  documentation and formatting changes do not need artificial tests.
- Reuse shared UI and regional controls. Keep language, calendar, digits and time zone
  independent, and check keyboard use and RTL when changing an interface.
- Include the matching English, Persian and German message keys when adding UI text.
  Call out wording that needs a fluent speaker's review.
- Discuss schema changes before implementation. Preserve applied migrations, document
  upgrade behavior, and coordinate the next migration number when the change lands.
- Authorization, privacy, cancellation and shared API changes need explicit review of
  their affected callers. Preserve existing stable error meanings and private denials.

## Send the pull request

Explain the problem and resulting behavior, link the related issue when one exists,
and include relevant validation. Add sanitized screenshots for a visual change. Describe
migrations, compatibility changes or operational steps when they apply.

A maintainer reviews scope, behavior and evidence before merging. Automated checks
inform that review. Reviews are asynchronous; no response-time guarantee is promised.

Contributions are made under the repository's [MIT license](LICENSE). Keep existing
copyright notices and identify any third-party material you introduce.
