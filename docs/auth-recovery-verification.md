# Login and recovery verification

Reviewed on 31 October 2026 against the login refinement based on main `8539fe8c4aeb0b58b6d05e629710460ef90bbed4`. The scope is the sign-in/help interface, password reset, factor recovery and the existing authentication safeguards. The concurrent email integration and calendar work are separate.

## Results

| Check                                      | Evidence                                                                                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Localized login and help                   | 95 unit tests across 27 authentication files, including Farsi, German and English interaction tests.                                                                                                                                           |
| Authentication protocols and authorization | 164 integration tests across 42 authentication files, using disposable PostgreSQL databases and real migrations.                                                                                                                               |
| Delivered password reset                   | Native requests generate encrypted outbox messages. The worker sends them through Nodemailer's real SMTP transport to a loopback receiver. Both Farsi and German messages contain the issued link and the correct HTML language and direction. |
| Reset completion                           | Following the delivered link leads to the configured reset page. Successful redemption revokes the previous session, requires a subsequent sign-in and retains existing TOTP state and registered passkeys.                                    |
| Recovery proof                             | After password reset, password sign-in still requires MFA. A saved recovery code completes that step once; replay is rejected.                                                                                                                 |
| Expiry and concurrency                     | Expired reset proofs leave credentials and connected-app grants unchanged. Concurrent redemption has one winner, produces one reset audit event and does not automatically sign the user in.                                                   |
| Public response and redirects              | Known and unknown addresses receive the same response body and status. Unknown addresses receive no message. Cross-origin requests carrying browser cookies and untrusted return URLs are rejected.                                            |
| Existing safeguards                        | The integration suite also covers shared account/IP throttling, factor replay, native session revocation, administrator recovery approval, operator execution and transactional failure rollback.                                              |

Better Auth disables origin checks by default when it detects a test environment. The application now explicitly keeps origin and CSRF protection enabled, so qualification exercises the configured security policy rather than that SDK testing default. This is an explicit configuration safeguard, not evidence that production origin checks were previously disabled.

The new regression tests are `passwordReset.security.integration.test.ts` and `passwordReset.smtp.integration.test.ts` in `src/features/auth/better/`. The SMTP receiver is test infrastructure only and binds to `127.0.0.1` on an ephemeral port. It handles both base64 and quoted-printable text so Persian mail is verified after MIME encoding.

## Reproduce

Use the package-pinned Bun version and an available Docker daemon. Run from the repository root:

```sh
bun run test:unit src/features/auth
bun run test:integration src/features/auth
bun run typecheck
bun run lint
```

When Docker uses a named local context, pass that context's socket through `DOCKER_HOST` for the test process. The qualification does not change the global Docker context, use the preview database, send messages to external mail servers or alter real user credentials.

## Installation checks still required

The SMTP qualification uses plaintext on loopback to isolate the protocol tests. Before accepting a deployed installation, verify its HTTPS origin, SMTP TLS/certificate configuration and actual delivery to designated test mailboxes. Physical passkey devices and external identity-provider tenants also need installation-specific checks.

Identical response content and the SDK's dummy token lookup mitigate account disclosure; these tests do not establish constant-time behavior or resistance to a distributed attack under production load. Privacy retention, access governance and GDPR compliance require separate operational verification. Existing dependency findings remain recorded in [auth-dependency-review.md](auth-dependency-review.md).
