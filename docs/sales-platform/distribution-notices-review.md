# Dependency and distribution notice inventory

Read-only source review on `f006b5a5026449fd2bf792439b9149ba3517feb8`,
1 November 2026. This records concrete packaging work and evidence gaps. It is
not a legal conclusion, transitive license closure or an inspected Docker image.
No dependency install, image build or external request was performed.

The lock is unchanged from the b8 application base. Its SHA-256 is
`529a9b6a87d9fc836c45a8e68f0da012ed8a111b0fc60b09a0e5c3c8bfbef0e4`.
Package changes add Sales script aliases only. The bounded installed-metadata
inventory found 67 direct runtime and 39 direct development dependencies.

## Concrete distribution follow-up

The Docker runtime copy list includes production dependencies, Next output,
public assets, worker bundles and migrations. It does not explicitly include the
root application LICENSE or curated `third-party/` notices. The shadcn notice
currently sits under `docs/`, which `.dockerignore` excludes. A later fix should
place its byte-identical notice in the included third-party tree and explicitly
copy root LICENSE and that tree into the runtime stage. Preserve the public font
notices, which already accompany `public/`.

The build stage uses `COPY . .`, while the current `.dockerignore` lacks an
explicit `.runtime` exclusion. Git ignore does not establish Docker-context
exclusion. Before a Docker image build from the task checkout, add `.runtime`
and nested `**/.runtime` exclusions so private profiles and database fixtures do
not enter its context. No Docker build or disclosure was observed. The completed
Next-only build does not exercise this distribution path.

Source pointers: `Dockerfile` build-stage COPY and runtime COPY list,
`.dockerignore`, root LICENSE, `docs/third-party/`, `third-party/` and
`public/licenses/`.

## Exact existing notices

| Notice                   | SHA-256                                                            | Observed distribution evidence                        |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------- |
| Root MIT LICENSE         | `88b3bcb8439f098f408eb5b5f371f385a0f2400e476358bbc592ec2bb2ecebac` | Present in source; no explicit runtime COPY           |
| shadcn notice            | `1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f` | Present under excluded docs; needs included path      |
| Curated xyflow notice    | `f4318bf37285d4c44c9f2620e97f3d6f9efcb2d9f763f91f483f840a9936740f` | Present in third-party; no explicit runtime COPY      |
| Public Inter OFL         | `5dd548d31a85f756e01d63e00d7faf1e324103ed3e9102fcbbabf2cc2db6dd39` | Byte-identical to docs original; public assets copied |
| Public Vazirmatn OFL     | `e6f4ce7b6c830d5a25a4f8ac777c267cd7d3c180bc2a7150ca57cbb9b280c4b7` | Byte-identical to docs original; public assets copied |
| Public Vazirmatn authors | `f0d13497a9039d3aed9d935c3faa0640f69322a8c7833a64f3527328cc70bbc1` | Byte-identical to docs original; public assets copied |

Installed `@xyflow/react` 12.12.0 and `@xyflow/system` 0.0.83 contain matching
MIT license text with SHA-256
`023119ac20fb1c8c9930abe0bcd196989a1960388529a96fc43cebf96f07c9ff`.
That package-level evidence is separate from the curated notice copy gap.

Two direct runtime packages declare Apache-2.0 in installed metadata but have no
root LICENSE/NOTICE file there: `drizzle-orm` 0.45.4 and `mcp-handler` 2.3.0.
`posthog-node` metadata declares MIT while its installed license contains
Apache/MIT material. Metadata alone is insufficient for notice completeness.

Next qualification should bind a notice manifest to the exact commit/lock,
retain source/license-file hashes and unresolved entries, check the eventual
runtime image and account for transitive/bundled material. Source and font notice
preservation, a frozen install or a successful web build cannot substitute for
that artifact inspection.
