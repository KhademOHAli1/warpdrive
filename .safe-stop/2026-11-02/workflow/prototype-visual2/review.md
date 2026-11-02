# Bounded prototype visual playback review

**PASS for these captured cases.** I visually inspected the five target states and two FA scroll captures (seven PNGs). The visible content agrees with the stored document URLs: DE history `19:4960` → waiting `29:5400`; FA ordered `16:6660` → inspector `16:6730` → variable search `45:7118`. No actionable visual defect was identified within the visible reviewed areas. This does not complete WF005.

The DE history and waiting images show distinct, coherent states: the waiting detail identifies version 2, two completed steps and step 3 waiting, with downstream work not started. The Actual 100% viewer and Flows sidebar leave the prototype's right edge outside the 1512×772 capture. That is a review limit caused by the viewer; it does not establish a prototype clipping defect or qualify the unseen rightmost content.

The FA proper baseline uses `scaling=scale-down`. Its narrow frame is visible at approximately x605–905, y60–710. Downward scrolling reveals the lower history/provider-status controls; upward scrolling restores the workflow heading and upper content. The shell header stays at the same coordinates in all three captures. The fourth task remains selected, and the fifth step identifies a local email draft. No horizontal clipping is apparent in the reviewed narrow content. Run owner reports selecting Options → Fit width/height before the proper baseline; the stored pre-baseline `min-zoom` and baseline `scale-down` URLs corroborate the viewer-mode change, not a prototype edit.

The inspector shows the task-title error beside the empty red-outlined field and the variable-selection control. The search state visibly contains `عنوان`, the label `جست‌وجوی متغیر`, and a purple halo (approximately x625–887, y210–239). The matching title result and LTR `steps.deal-read.output.title` path are legible. The fallback field and full green `ثبت متغیر و مقدار جایگزین` Apply control fit inside the panel (button approximately x627–884, y521–550). These are visible prototype states; actual filtering and input focus were not exercised or established by this review.

AX supports document/node identity only. The recorded FA tree states that screenreader support is disabled and identifies the focused element as AXWebArea. It does not establish DOM input focus, keyboard operation, accessible names, focus return or AT behavior. The purple halo proves visible styling only.

## Exact reviewed images

| PNG | Actual node | SHA256 |
| --- | --- | --- |
| `de-history.png` | `19:4960` | `3a5163c422f462c3cfc29bb4c633a04ec304f0f6566eb329c74b57e1d72c4829` |
| `de-waiting.png` | `29:5400` | `f2f05aa77e262549ff3c4197095a2c4709964c93c4497e82ab859f2a3e502cc9` |
| `fa-ordered-fit.png` | `16:6660` | `c1b6677e1c8b929303db55ad17ec79ac5b9d44e6a05c4c7dc285a751d6437bfd` |
| `fa-ordered-scroll-down.png` | `16:6660` | `5503b032b2b12f20e3893451e28ffa92125e044ff2497f806a2412b27778cae8` |
| `fa-ordered-scroll-up.png` | `16:6660` | `6ac111a3f3d072a3f5d82b947a2c08a0028abd8a8bab8139a45ee847ed05d8e4` |
| `fa-inspector.png` | `16:6730` | `200061377d45d3fb58b567409894b0dd8cbcde796975c85dd4b646075c8a3176` |
| `fa-variable-search.png` | `45:7118` | `0642853e13214cea5e27145b9e9b4454ee3a9fe28500cda33367b1c024b3e539` |

## Timing, preservation and remaining gates

`admission.json` records 05:35:54.852853Z and cleanup records 05:40:46.127Z: **291.274147 seconds**. The conservative bound from the earlier pregrant clock is **432.371071 seconds**, below the 600-second whole limit. The exact grant-receipt clock was not captured; case 1's 91.072147 seconds is admission-to-waiting, not an exact grant-relative time. Resource records are endpoints only (pressure 1, Q52 → Q54), with no continuous or peak claim.

`owned-tab-cleanup.json` records all three owned tabs absent and both foreign IDs preserved, with no foreign URL changes, viewport override, global browser kill, prototype writes, app actions or DB actions. This is a review of saved cleanup evidence, not a new live browser inspection. Separate owner source readback records 336 pins without mismatches and the expected pre-job test delta; I did not inspect managed source.

The full workflow journey, remaining locale/theme playback, real keyboard/AT behavior and app/DB/worker/provider runtime remain open. I did not re-review unchanged R2 exports or the diagnostic initial PNG. This review wrote only this note and its companion JSON; input artifacts were preserved.
