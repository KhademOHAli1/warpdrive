# Component inputs and retained build identity

Component shipping requires evidence that unchanged images still match the current source
inputs. An image's OCI source revision remains the revision that actually built it. A later
release revision must never be written onto a retained image to make its provenance appear
current. These checks contribute to OPS-002 and OPS-011; all deployment programme gates remain
separate from input equivalence.

## Discovery and independent verification

`scripts/build-workers.mjs` shares its production esbuild options with write-free discovery.
Each selected component resolves its dependency graph twice, with inventory hashing between
the passes. New imports, changed directory membership, graph warnings, unresolved application
imports, symlinks and changed files hold the result. External packages must be covered by the
locked production dependency closure; the runtime still ships the production dependency
installation, including package-relative data files.

The inventory includes shared locks, package/build configuration, patches, runtime assets,
licenses and tooling policy sources. Worker and Web retain the workflow code child process;
operator helpers remain in the components that ship them. Migrator inputs include the complete
Drizzle SQL and metadata tree. The immutable Bun base must match the actual Docker recipe.

Generate a receipt outside the checkout, then independently verify its hashes, current file
contents and a fresh discovery result:

```sh
input_work=$(mktemp -d)
node scripts/deployment/component_inputs.mjs \
  --base-image oven/bun@sha256:3f23864d3e8c923975c61971cabe67ee3d5a728f1e25a559256b95af719a3478 \
  --platform linux/amd64 --component worker > "$input_work/worker-inputs.json"
python3 scripts/deployment/component_inputs.py \
  --receipt "$input_work/worker-inputs.json" --root "$PWD" --component worker
```

Omit `--component` from both commands for all four Core images. These commands discover and
verify inputs; they do not compile Next, build an image, publish or deploy. Receipt output must
remain outside the checkout because the current Web fallback inventories repository sources.

The Python verifier recomputes recursively key-sorted compact UTF-8 JSON hashes, opens files
beneath a directory descriptor without following symlink ancestors, and bounds the fresh
discovery process's output and lifetime. Validating a supplied inventory alone is insufficient:
a newly imported file can be absent from a self-consistent old list. Current-source admission
must run fresh discovery and compare the complete result.

The discovery policy admits at most 20,000 files, 32 MiB per file, 256 MiB per component's input
contents and 10,000 graph inputs. Retained receipt JSON is limited to 4 MiB before image builds.
These are source-tooling budgets, not production capacity declarations.

## Bootstrap provenance and remaining reuse work

Candidate/bundle version 2 binds the input receipt, release revision, actual per-component
build source and input/policy digests to the same tested image IDs. The fixed bundle inventory
adds `component-inputs.json`; the API-bound ZIP, manifest, every file checksum and reconstructed
candidate must agree. Legacy version 1 bundles retain their original inventory and validation.

The current version 2 producer admits fresh builds from the selected release revision only.
Candidate creation checks the checkout's exact Git HEAD, refuses tracked modifications and
compares every declared input's size and SHA-256 with the selected commit's raw Git blob,
before and after discovery. This comparison ignores index optimization flags, replacement
objects and content filters; a quiet diff cannot hide an input changed under `assume-unchanged`
or `skip-worktree`.
It retains the `independently-qualified-component-reuse` gate and rejects an old image claiming
the new release identity. Mixed-source assembly still needs authenticated original build and
qualification receipts, safe unchanged-component selection, unchanged original image labels
and a newly tested assembly. Input hashes alone authorize none of those actions.

Web currently uses a conservative repository-source inventory plus its actual helper graphs.
This intentionally includes more than the Next application graph while Tailwind discovery and
development instrumentation remain coupled. UI files outside backend dependency graphs can
leave backend input hashes unchanged. General worker-only changes skipping Next compilation
remain unqualified. Newsletter Engine and ingress inputs, explicit engine migration execution,
cross-version API/WS/job/asset compatibility and installed release acceptance remain separate
programme requirements.

## Real source boundary regression

`scripts/deployment/component_boundaries.mjs` copies the bounded current source inventory
into its own temporary directory, verifying every copied byte. It uses the existing dependency
installation without writing into it. Only the temporary copy is changed, and it is removed
after the check. Fresh production dependency discovery verifies three cases:

- Registering the actual Operations UI namespace, including all three catalogs and the Next
  declaration, changes Web inputs while Worker, Realtime and Migrator inputs stay identical.
- Editing existing table-control UI copy has the same boundary.
- Editing notification email copy changes Worker and Web inputs; Realtime and Migrator stay
  identical. Notification mail catalogs are physically separate from UI catalogs, and UI
  assembly preserves the existing `notifications.email` namespace and locale fallback.

The final-image workflow retains the boundary report alongside its input receipt. A local
working-tree run passed all three cases in 23 seconds on 11 November 2026. This is source
dependency evidence; the exact committed Linux image and complete release gates still apply.
