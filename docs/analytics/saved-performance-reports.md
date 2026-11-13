# Private saved Performance reports

Under **Saved Performance reports**, enter a name and select **Save current
filters**. The definition retains the pipeline, owner, currency, and fixed dates
for a period of up to 366 civil days. Select **Review filters** to inspect the
scope or **Run saved report** to query current data. The report uses the viewer's
effective time zone and current access to the saved scope. Running it leaves the
main dashboard's filters unchanged.

The server stores a versioned definition under the dedicated private Performance target in the existing saved filters table. Each owner can save up to 50 definitions. A transaction-scoped owner lock protects concurrent creation. Ordinary CRM saved-filter endpoints limit their mutations to their registered targets. Both Performance mutations use the native session authority and double-submit CSRF check. They check the session again after writing so expiry during a lock wait rolls back the mutation. A definition from an unsupported version can still be removed by its owner.

The rerun accepts a saved definition ID. One read-only repeatable-read transaction on the primary checks the native session policy, owner, definition, exact current scope and report calculations. It withholds results when a named pipeline or owner scope is unavailable. Explicit self-user selections retain their original selector identity. It also withholds an oversized pipeline or team population instead of narrowing it. A fresh wall-clock expiry check runs before return.

The report panel displays the saved scope and headline metrics. The ordinary
dashboard and saved rerun share calculation code. The native fixture covers
parity, permission changes, unknown versions, and revoked sessions. Sharing,
saved chart selection, and additional report types remain open. Check the
[programme status](programme.md#status-pointers-13-november-2026) before using
source integration as evidence for an installation.
