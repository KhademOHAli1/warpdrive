# Frontend 1.7.1.4: device sessions and newsletter activation

New sign-ins use a persistent, host-only `wd_sid` cookie and a matching fixed
fourteen-day server expiry. The default idle and absolute limits are fourteen
days, with session refresh still disabled. Activity does not extend that
deadline. Existing expiry timestamps are not rewritten. Sign-out, revocation,
inactive-account checks, verification, MFA and fresh privileged authentication
continue to apply.

Migration `0119_device_session_lifetime` raises the supported idle-policy limit
and updates only the former 30-minute/seven-day policy defaults. Deliberately
customized shorter policies remain intact. Modern sessions already expired under
the previous policy are revoked before widening its limits; the legacy workflow
compatibility rule is unchanged. When an existing installation has
no policy row, its operator must persist the new defaults before reusing older
Worker/Core images, which otherwise retain their original fallback defaults.

After the server confirms a fully verified sign-in, this browser remembers only
the primary method in `wd_last_signin_method`. This non-secret, host-only
preference lasts one year. It contains no account identity, password, token or
authorization. The login screen prioritizes it only while that method remains
available; it never starts authentication automatically. Other choices remain
available. Pending or failed verification does not update the preference.

The installed Web process also needs the existing private newsletter connection
and read-only token-file mount. Configuring only the separate Core and Worker
does not expose Campaigns in Web's server-rendered navigation. Activation must
preserve the current engine, records, sender policy and unscheduled campaigns.

Source checks, actual PostgreSQL and cookie tests, a built image, private runtime
qualification and public installed read-back are separate evidence. This note
does not claim that a deployment has completed.
