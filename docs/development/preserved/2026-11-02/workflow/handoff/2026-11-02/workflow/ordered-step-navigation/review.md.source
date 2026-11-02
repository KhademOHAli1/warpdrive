# Ordered-step navigation source review

**PASS within the reviewed scope; no actionable defect found.** I compared all six UI production changes with `red-surfaces-source`, inspected the current helper and five relevant test files, and reviewed the existing red/green evidence without running checks. All 12 current helper/UI/test hashes match `green-affected-preflight.json`.

The helper (`nodeOrder.ts:3–36`) uses local dependency maps and selects the first creation-order node whose known incoming edges are resolved. It retains node object identity and every node entry. Missing endpoints do not suppress nodes; unresolved cycles/dependents retain original tail order. Duplicate IDs return the original array. These are sensible invalid-draft display fallbacks, not validation or publication approval.

The six UI deltas consistently consume that display projection:

- `BuilderWorkspace.tsx:176–193` changes step-strip order/numbers while retaining ID-based selection.
- `RunTrace.tsx:87–110` changes historical display order; completion lookup, selection and reveal remain node-ID based.
- `BindingField.tsx:41–58,70–75` changes label numbers only; variable eligibility, option keys and reference bindings stay intact.
- `ConnectionEditor.tsx:32–77` and `EdgeInspector.tsx:30–97` preserve source/target IDs, port rules and existing connect/disconnect validation.
- `WorkflowCanvas.tsx:85–105` maps displayed indices by ID but still maps the original node array. Node references, stacking order, position/measurement derivation and selection are preserved; duplicate-ID drafts retain original indices.

No reviewed change writes or replaces stored nodes, configs, bindings, edges or layout. Branch ties use stable creation priority; the resulting total display order does **not** represent runtime branch choice or execution chronology. Runtime/SQL changes are outside this delta and were not inspected or requalified here.

## Regression evidence

The eight pure cases (`nodeOrder.test.ts:37–113`) assert count, identity and no mutation, covering insertion, both edge-order branch variants, dangling/disconnected nodes, cycle tail, self-loop, duplicate IDs and already ordered input. An independent helper subreview also found no defect.

The four UI files meaningfully exercise the affected consumers: actual insertion and ordered navigation (`ConnectionInsertion.test.tsx:250–271`); Canvas creation/z-order preservation with new indices (`WorkflowCanvas.test.tsx:118–169`); historical numbering plus existing keyboard selection (`RunTrace.selection.test.tsx:17–105`); and consistent binding/connection/edge selector labels without render-time edits (`NodeOrdinals.test.tsx:70–144`). Canvas's ReactFlow implementation is mocked, so that case establishes adapter props rather than rendered geometry.

Existing receipts record surface **6 intended RED / 9 controls**, pure **6 RED / 2 controls**, then **37 PASS across 9 files**, 5.21s Vitest / 5.55s wall. Raw red-log hashes match their observation receipts. Root reports Biome12 PASS with two infos/two formatted; this is not zero diagnostics. No check was rerun by this reviewer.

Configured whole-project types/typed lint and Main/CI remain pending at this review. Browser geometry, narrow scrolling, keyboard/AT qualification and whole WF017 acceptance remain open. Only this note and `review.json` were created; managed source, refs, runtime and peer artifacts were preserved.
