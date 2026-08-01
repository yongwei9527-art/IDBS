# Android server-pairing bridge

The Android app deliberately contains **no administrator credentials, pairing secret, database credentials, or long-lived pairing token**. It supports the secure configuration flow below without adding a camera/scanner dependency.

## Supported pairing link

The native activity accepts an Android deep link or a scanner result in this shape:

```text
labapp://pair?v=1&server=https%3A%2F%2Flab.example.com&token=<short-lived-one-time-token>
```

`server` must be an HTTPS URL with a host, no embedded user/password, query string, or URL fragment, and either no explicit port or port `443`. The app validates this before notifying JavaScript. The `token` is held **only in memory** and is never persisted by the native bridge.

## Web bridge contract

Use Capacitor's `NativeRuntime` plugin. The web layer must exchange the token with the selected server over HTTPS before saving the result.

| Method/event | Contract |
| --- | --- |
| `getConfiguration()` | Existing method; now also returns `serverConfigured: boolean`. |
| `getServerConfiguration()` | Returns `{ configured: boolean, serverUrl?: string }`. The URL is Android-Keystore AES-GCM encrypted at rest. |
| `saveServerConfiguration({ serverUrl })` | Persists the **server-verified canonical HTTPS URL**. Rejects non-HTTPS, credentials, fragments, and non-443 ports. Do not call before token exchange. |
| `clearServerConfiguration()` | Deletes the persisted encrypted server URL. |
| `ingestServerPairingLink({ uri })` | Lets a future Web/native QR scanner submit a scanned `labapp://pair` URI. Returns `{ serverUrl, pairingToken, version }` after validation. |
| `getPendingServerPairing()` | Returns `{ pending, pairing? }`; use after app launch or resume. |
| `serverPairingLink` | Retained Capacitor listener event with `{ serverUrl, pairingToken, version }` after a valid Android deep link or scanner submission. |
| `acknowledgeServerPairing()` | Clears the in-memory pairing token after the server accepts or rejects it. |

Required web sequence:

1. Receive a pairing payload through the event or `getPendingServerPairing()`.
2. `POST` the one-time `pairingToken` to the advertised server's pairing-exchange endpoint using HTTPS.
3. Verify the response's canonical server URL matches the intended trusted server policy.
4. Call `saveServerConfiguration({ serverUrl: canonicalUrl })`.
5. Call `acknowledgeServerPairing()` whether the exchange succeeds or fails.
6. Continue to the normal user login screen. Never place or derive a user/admin password from the QR code.

## Native validation

From `web/android`, run:

```powershell
.\gradlew.bat :app:compileDebugJavaWithJavac
```

No QR scanning library is declared by this change. A scanner can be integrated later by passing its raw scan text to `ingestServerPairingLink`.