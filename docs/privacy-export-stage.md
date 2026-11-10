# Private archive staging composition

`stagePrivacyExportArchive` connects the existing reviewed-metadata archive codec to injected private object storage. It is an internal building block for DPL-09, not an executable export job or a disclosure grant. There is no production caller, public route, bucket activation or publication path.

The caller must allocate and durably record the exact artifact/attempt identity before calling. The helper canonicalizes that identity and snapshots a valid manifest before awaiting storage initiation. Mutating caller metadata while initiation waits cannot change the archived manifest or expected source hashes. A manifest marked reviewed still needs independently current server authority and a durable approved scope; this helper supplies neither.

After initiation, the real TAR/gzip codec opens only its declared sources, validates bytes and SHA-256, and finishes the storage sink. Only codec success can call multipart completion, once. Success returns the codec receipt and exact stored object reference. The existing storage adapter independently checks its measured receipt and exact-version HEAD.

Failures are static phase/code values. Before I/O there is no repair reference. An uncertain initiation retains the preallocated attempt even when no upload ID was observed. Archive or completion failures retain the exact attempt/upload references for future reconciliation. The helper does not retry, abort remote uploads, delete completed objects or claim absence. Cancellation throws the caller's unchanged reason, and the caller's durably recorded attempt remains the repair anchor. Local sink teardown does not prove remote rollback.

Six focused tests exercise the real Unicode archive roundtrip through an injected storage stub, preflight rejection, immutable metadata during delayed initiation, real streamed checksum rejection, completion uncertainty without replay, and rejection of late completion after cancellation. They establish composition behavior only. There is no database, native authentication or configured-provider qualification from those tests.

The separate 12-case native storage selection passed on 1 November 2026 with disposable real PostgreSQL and pinned SeaweedFS, including real connection cancellation while completion or HEAD was held. It qualifies the storage adapter and its exact source cut, not this higher-level helper's durability, current approved scope, publication, scale or installed acceptance.

## Durable execution prerequisites

The existing `privacy_jobs` schema permits export and holds claim/lease, authority generations and encrypted result bytes. The live enqueue/claim/completion services remain discovery-only. They cannot be turned into an export executor by changing a kind string or reusing `case.review`.

There is no durable approved-scope sealer/loader yet. Identity scope version and disclosure revision are distinct. The next durable work must establish current reviewed source/projection/file descriptors, persist and bind the sealed disclosure revision, and reject stale authority, policy, recipient or source state.

An export attempt ledger must persist its exact allocated attempt before storage I/O, preserve unresolved attempts across lease replacement, bind encrypted contents to job and case, fence updates with current export authority and claim/lease generations, and record uncertainty without automatic replay or success. Repair after originating authority revocation needs an explicit repair authority. Storage calls belong outside database authorization transactions. These APIs and their real PostgreSQL concurrency/recovery evidence remain open.

The entire DPL-01 through DPL-36 objective, localized reviewer UI, configured-provider behavior and all 12 installed/operator gates remain open. Ali confirmed that no staging deployment exists yet.
