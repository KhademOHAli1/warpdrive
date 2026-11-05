# Private out-of-time forecast probability evaluation

This model-evaluation increment for #600 and #8 uses the existing forecast evaluation and native receipt contracts. The money and probability evaluators share frame and matched-roster validation.

The private scorer accepts a prospectively frozen holdout plan for one exact measurement, one immutable model artifact and its complete target list. Each period uses a forecast commit receipt from the existing independent native verifier and a separate later finalized actual manifest. The scorer checks the receipt against the original cutoff, strictly pre-target observation, currency and target. It checks canonical forecast and actual manifest fingerprints, exact roster and mature outcome coverage, holdout target order, model version, training/freeze times and the plan's pre-cutoff time. Changing a manifest after independent verification invalidates its binding. The scorer refuses repeated deal or incarnation IDs across periods, partial outcome evidence and scenarios other than base. The target label is whether the saved open deal won within the half-open report period.

Version 1 uses ten fixed equal-width probability bins. Only the final bin includes its right endpoint. Each available bin returns exact rational mean prediction and observed win rate. Overall Brier loss is the exact mean of squared probability errors, computed from the saved 12-place probabilities with BigInt. The descriptive display floor is 100 observations, at least 20 of each outcome, and 10 observations per reported bin. These floors are a versioned reporting policy. They establish neither statistical power nor independence. Missing money does not affect probability eligibility when probabilities and labels are known.

## Issuer required before use

The production sources do not yet offer an issuer. The nominal input marks this boundary and is not itself an authenticity check. The future server adapter must supply:

1. The exact original immutable forecast bytes, custody-qualified against the independently observed native commit receipt, and a verified mapping of those bytes to the canonical forecast manifest. The helper hashes the parsed manifest with normalized identities and deterministic member order. It does not recalculate or replace the native request and payload digests.
2. A bounded settled-actual collector with current authorization for the full saved cohort, original incarnation membership, continuous positive and negative evidence through the target fence, and immutable finalization under the selected restatement policy. Current deal status is insufficient for a no-win witness.
3. A prospective holdout registry and immutable trained artifact, with membership and target selection frozen before prediction, training and feature provenance limited to each prediction cutoff, no holdout outcome or future feature access, and model/version correspondence to the original prediction bytes. Timestamp and digest equality alone cannot verify a trained model or detect leakage.

The current manual scenario belongs to the what-if report. Production calibration needs a separately qualified issuer. The seven synthetic cases cover arithmetic, bin boundaries, sparse samples, evidence substitution, chronology, duplicates and incomplete labels. All 37 focused forecast, evaluation and calibration tests passed.
