# dsh-webui-oauth

English | [中文](README.md)

A persistent WebUI authentication plugin for DeepSeek Harness. Once you create an account/password in **Settings → 身份认证 (Authentication)** or via the first-run login page, **unauthenticated browsers cannot load any WebUI resource, call any API, or open any realtime connection** — authentication is enforced at the HTTP/transport layer and cannot be bypassed through browser devtools. Both local password accounts and **OIDC/SSO single sign-on** are supported.

> **This plugin is an enhanced replacement for [Yuuz12/dsh-webui-auth](https://github.com/Yuuz12/dsh-webui-auth)** (adding OIDC SSO and more). **After installing it you must remove the original from your profile's bundle list** (see "Relationship to the original") — running both at once makes them fight over the same routes, and no coexistence mode works; on detecting that conflict this plugin **refuses to boot** (dsh exits with code 1 and prints the fix) rather than degrading. Credentials and the data directory keep the original location, so **existing accounts and sessions keep working**.

## Relationship to the original (pick one — never enable both)

The original `dsh-webui-auth` and this plugin both claim **the same set of routes** through `ctx.webServer.register()` (the `""`, `/api` and `/plugins` prefixes plus the `/api/remote.mux` upgrade route). The webServer route table is **first-come-first-served**: registering the same `(kind, path)` twice throws `duplicate ... route`, and route entries **carry no owner information** (only `{kind, path, handler}`), so there is no way to tell afterwards who registered a given route.

**Runtime displacement is therefore architecturally impossible.** This plugin used to try two variants; both were falsified on an isolated instance:

| Attempted approach | Measured result |
| --- | --- |
| Runtime `dispose` of the original's fibers | The original's `apply` hits `INACTIVE_EFFECT`; **the whole dsh process fails to start** |
| Runtime `disable` of the original's entry | The original's routes are already registered, so this plugin's registration hits `duplicate prefix route`; **the process fails to start** |
| Do nothing, let both coexist | The process starts, but **only the original takes effect** — every endpoint of this plugin 404s (silent failure, the hardest kind to diagnose) |
| **Remove the original at config level** (recommended) | Starts normally; this plugin is fully in effect |
| **Install only this plugin** (recommended) | Starts normally; this plugin is fully in effect |

The first two are load-order independent (both orders reproduce): whoever registers first wins, and the latecomer throws and is rejected by the boot audit.

**The right fix**: after installing this plugin, drop the original from the profile's dependencies and bundle list. Edit `$DSH_HOME/profiles/<name>/package.json`:

```jsonc
{
  "dependencies": {
    // remove this line:
    // "dsh-webui-auth": "^0.3.5",
    "dsh-webui-oauth": "^0.4.4"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        // remove this line:
        // "dsh-webui-auth",
        "dsh-webui-oauth"
      ]
    }
  }
}
```

To keep the dependency but merely mask the original, disable its entry by id in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-webui-auth
  disabled: true
```

**A double install fails the boot outright (fail-fast).** If the original is still enabled, this plugin **throws at the very start of `apply`**, so dsh exits with code 1 and prints a single readable fix instruction to stderr:

```
[dsh-webui-oauth] 检测到原版 dsh-webui-auth 同时启用，拒绝启动。两者抢占同一批路由（webServer 路由表先到先得），
实测无法共存：本插件的登录页与闸门会完全失效（端点 404），或直接导致启动失败。
修复：从 profile 的 dsh.profile.bundles 与 dependencies 中移除 dsh-webui-auth，
或在其补丁层写 disabled: true，然后重启。
```

**Why refuse to boot instead of degrading**: measurements show there is no usable coexistence mode (see the last two rows of the table above). "The process starts but gate ownership is undefined" is the most dangerous shape of all — the operator believes the door is locked while every endpoint of this plugin 404s. Rather than serve traffic in a half-broken state, this plugin blocks the problem at startup and states the fix.

(Cordis's default logger only fills an in-memory buffer and never reaches stdout/stderr, hence the explicit stderr write — that line is the only readable clue for the failed boot, so `docker logs` / `journalctl` must show it.)

- **Matching is by plugin name only** — no other plugin is touched; when the original is absent this plugin stays completely silent.
- **It never mutates anyone else's lifecycle**: this plugin does not `dispose` or `disable` any sibling entry or fiber.
- **Data carries over seamlessly**: the data directory (`.dsh-webui-auth/`) and credentials file (`dsh-webui-auth.json`) **deliberately keep their original names**, so accounts created by the original work without migration.
- **Adopting the original's data directory**: when this plugin has no credentials of its own yet, it looks for an original data directory that already holds credentials and **reuses it directly** (not copies — copying would produce two credential sets that diverge as soon as one side changes the password):
  1. the sibling directory `../dsh-webui-auth/` (the usual case for source / `link:` installs);
  2. `$DSH_HOME/dsh-webui-auth/` (the original's fallback location).
  If neither exists it uses its own directory (fresh install, driven by the setup token). **When it already has credentials it never adopts**, so data created under the new plugin is never overwritten.
- **OIDC config lives in its own file**: account credentials stay in `dsh-webui-auth.json`, while the OIDC config (including `clientSecret`) goes to this plugin's own `dsh-webui-oauth.json`. Older versions kept the `oidc` section inside the credentials file — it is still read from there (transparent upgrade) and migrated on the next save.
- Uninstalling the original and keeping only this plugin works too.

## Architecture

Authentication is enforced in four layers, all implemented by **wrapping the webServer routes at runtime — no DSH core package source is modified**:

| Layer | Mechanism | Unauthenticated behavior |
|---|---|---|
| WebUI resources (index.html, /assets/*, SPA routes) | Plugin registers a `prefix ''` catch-all route; after session validation it hands off to frontend-static | 302 → login page |
| Plugin bundles (/plugins/*) | Wraps the `/plugins` prefix route handler at runtime | 401 |
| /api RPC surface | Wraps the `/api` prefix route handler at runtime | 401 |
| WebSocket (`/api/remote.mux`; legacy cores `/api/events.mux`, `/api/events.host`) | Wraps the upgrade route handlers at runtime | 401 upgrade rejected |

- **No core patching**: a DSH upgrade never overwrites patches and never leaves `/api` exposed after an upgrade. Every startup re-wraps the route tables, with a 2s→10s rescan loop that catches late-registered routes. **On v0.1.2-alpha.2+ the event-stream WebSocket lives at `/api/remote.mux` (registered by dsh-api-gateway); the candidate list adapts automatically, so the plugin no longer falsely reports "upgrade route missing".**
- **Fail-closed**: if the expected routes are missing (DSH internals changed so wrapping can't apply), `setup`/`configure` **refuse to enable authentication** and the problem is reported both in the host log and on the settings page — better unusable than "login enabled with an unprotected /api".
- **Cooperation with the core's own browser auth (v0.1.2-alpha.2+)**: that core version ships launch-token exchange with an origin-bound signed cookie (`dsh-auth-*`) guarding `/` and `/api`. After a successful plugin login the browser is automatically sent to the core's token-bearing root URL so the core cookie exchange runs too; `/api` requests pass through **unchanged** after the plugin session check (no more Host/Origin rewrite, which would break the core's cookie/Host binding). Both gates apply: a browser must hold the plugin session cookie **and** the core cookie.
- **Privileged methods behind a reverse proxy / LAN (legacy cores ≤ alpha.1)**: after the session check the plugin hands authenticated requests to the core in a "loopback shape", so the core's **loopback-pinned privileged methods** (settings/credentials/agentPreset/llm.discoverModels) work in proxied deployments — the session-cookie gate is a strictly stronger identity proof than the Host-header heuristic it replaces.
- **WebSocket and `trustedHosts`**: the WS upgrade handshake still goes through the core's own `requestRejection` / `isTrustedApiRequest`, so **in reverse-proxy / LAN deployments (non-loopback Host) you must also add the public hostname to `client-connection.trustedHosts` in the DSH config**, otherwise even authenticated upgrades are rejected.
- **Unified "browser-influenced origin" switch (0.4.1)**: two redirect sites trust an origin **supplied by the requester (the browser)** — ① the OIDC callback base (the login page reports `location.origin`); ② the post-login core token redirect (authority comes from the request `Host`). Both **share one switch**, configured in the dsh settings `remote-web-ui` section (deployment level):
  ```yaml
  remote-web-ui:
    publicBaseUrl: 'https://dsh.example.com:8443'   # deterministic origin (optional)
    trustBrowserOrigin: false                       # off: both sites use only the deterministic origin
      - 'https://dsh.example.com:8443'
  ```
  - `trustBrowserOrigin` defaults to `true` when omitted (legacy behavior); an explicit `false` makes both sites **ignore** the browser-influenced origin and use `publicBaseUrl`. With no `publicBaseUrl` either, the token redirect falls back to the request Host / loopback, and OIDC fails closed with an error.
  - The old `oidc.trustBrowserOrigin` is still accepted: when the settings section does not set the switch explicitly, it is used as the fallback, so existing deployments migrate smoothly.
  - **Host-rewriting reverse proxies**: when the proxy rewrites `Host` to a loopback address (`127.0.0.1:3080`, `::1`, `localhost`, `0.0.0.0`) and sends nothing else, the plugin **cannot** recover the browser-side address from the request, so it treats the address as proxy-rewritten and uses the configured `publicBaseUrl` directly (the legacy "declare the public address in settings.yaml" advice was ineffective in that shape, because `publicBaseUrl` was only trusted on an exact Host match). If the proxy can send the original host, `X-Forwarded-Host` (or RFC 7239 `Forwarded: host=`) is preferred over the request Host for building the redirect.
- **Optional OIDC SSO (0.4.0)**: standards-based authorization-code + PKCE with a **confidential client (client_secret required)**, security-benchmarked against Logto. Once configured, the login page shows an "SSO single sign-on" button; after IdP authentication the plugin creates a local session keyed by the IdP `sub` (reusing the session TTL and persistence). The **redirect_uri base is set by `oidc.redirectBase`**; by default the browser is trusted (it trusts the front-end `location.origin` — under a host-rewriting reverse proxy the browser's public address is correct), ****constrained by the unifed switch above****; when disabled only the configured `redirectBase` is used; if neither is available it fails closed with an error. id_token signatures support **RSA (RS256/384/512, PS256/384/512), EC (ES256/384/512) and EdDSA (Ed25519)**, with iss/aud/exp/iat/nbf/nonce and JWKS(kid) validation (see "Signature algorithm support" below). Logout is the simple variant: it clears the local session only.
- **Scheme-adaptive post-login redirect (0.3.3, fixes #6 / #7)**: after a successful login the plugin sends the browser to the core's token-bearing root URL. Its **authority now comes from the request Host** (no longer hardcoded to `127.0.0.1`) and its **scheme follows the protocol the request actually used**, resolved in this order: ① the operator's explicit `remote-web-ui.publicBaseUrl` (**trusted only when its host/port matches the incoming Host** — otherwise a LAN direct hit would be redirected to the public address and lose the freshly issued session cookie to a cross-origin hop); ② the standard proxies headers `X-Forwarded-Proto` (leftmost value) or RFC 7239 `Forwarded: proto=`; ③ a TLS-terminating socket (`socket.encrypted`); ④ fallback `http`. It deliberately does **not** guess "non-IP hostname ⇒ https", which would turn plain-http intranet access (`http://nas.local:3080`) into a dead https link. The login page adds a one-way client-side fallback: an https page receiving a **same-origin** `http://` redirect upgrades it to `https://` (never downgrades, never rewrites another origin).

Sessions are **server-side and persisted to disk** (`sessions.jsonl`, survive a DSH restart, expire server-side), carried by an `HttpOnly; SameSite=Lax` cookie (`dsh_wua_session`) that JS cannot read; changing the password **revokes every other session**.

## Installation

This plugin is a standard **bundle** — the official `dsh plugin` command is the recommended way to install it. The manual method is kept as a fallback. Prerequisite: pnpm on the machine (Node ships corepack — run `corepack enable pnpm` to activate it).

### Method 1: GitHub install (recommended)

```sh
npx @deepseek-ai/dsh plugin --profile web add github:WU-HINS/dsh-webui-oauth
```

Fetches the repository source (plain JS — works directly, no build step).

> If you previously installed the original `github:Yuuz12/dsh-webui-auth`, you can switch straight to this repository — the plugin displaces the original automatically and reuses the same data directory, so no account needs to be recreated.

### Method 2: npm install

> Requires the package to be published on the npm registry. If `dsh-webui-oauth` is not published yet, use Method 1.

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-webui-oauth
```

Pulls the package from the npm registry, adds the dependency and appends it to the `dsh.profile.bundles` list; the plugin row is inserted automatically via the bundle layer.

### Method 3: manual (fallback)

1. Put the `dsh-webui-auth` directory into `profiles/web/node_modules/`
2. Add one row to the `insert` list in `profiles/web/cordis.patch.yml`:

```yaml
    - id: dsh-webui-oauth
      name: 'dsh-webui-oauth'
```

> Maintainer dev mode: `dsh plugin --profile web add ./dsh-webui-oauth` from a local source checkout (`link:` install) — edit code, restart DSH, done; no reinstall needed.

### Common to all methods

**No core-package patches are needed** (no `[dsh-webui-auth patch]` markers, no `node_modules` edits) — just restart DSH. On startup the host log prints `[dsh-webui-oauth] started, credentials file: ...`; if the route wrapping is incomplete it prints `ROUTE GATE INCOMPLETE` and authentication cannot be enabled (fail-closed).

## Uninstallation

### Method 1: `dsh plugin` command (for method-1 installs)

1. `npx @deepseek-ai/dsh plugin --profile web remove dsh-webui-oauth` (removes both the dependency and the bundle layer)
2. Restart DSH

### Method 2: manual (for method-2 installs)

1. **Delete the plugin directory** `profiles/web/node_modules/dsh-webui-oauth/` (since 0.3.1 runtime data lives outside the package, deleting it does not touch the account; to wipe the account too, also delete the `.dsh-webui-auth/` data directory — see "Data file locations")
2. **Remove the mount row** from `profiles/web/cordis.patch.yml`:

```yaml
    - id: dsh-webui-oauth
      name: 'dsh-webui-oauth'
```

   This step is required — otherwise the loader fails at startup because the package is missing.
3. **Restart DSH**

With either method, after the restart authentication is fully disabled (**no core sources to restore** — the plugin never modified core files). To also clear persisted sessions, delete `sessions.jsonl` in the data directory. If you previously used the older pre-hardening build, the leftover `dsh-webui-auth.session` key in browser localStorage is harmless and may be removed optionally.

## Usage

- **First enable (setup token required)**: while no credentials exist, authentication is off (all requests pass), but creating the administrator account requires a **per-boot setup token** — open WebUI → Settings → 身份认证 (Authentication), or visit `/dsh-webui-oauth/login`, enter the token printed in the startup log as `[dsh-webui-oauth] setup token (...)` (or read the `setup-token` file in the data directory, mode 0600), then create an account/password (≥8 characters, must include uppercase, lowercase, digit and special character). The token is regenerated on every boot and deleted once setup succeeds, preventing someone from claiming the administrator account in the "exposed before configured" window.
- **Username rule**: 3-32 characters of letters, digits, underscore or hyphen (enforced on create/change; legacy accounts are unaffected and can still log in).
- **Afterwards**: any unauthenticated visit to any path redirects to the login page; after login you stay signed in for the chosen **session lifetime** (browser session / 1 hour / 12 hours (default) / 1 day / 3 days), enforced server-side by expiry. **Sessions are persisted to disk — after a DSH restart logged-in devices stay signed in** (the expiry still applies). "Browser session" mode: the 30-minute window slides with activity, and closing the browser logs you out.
- **Change / disable / log out**: Settings → 身份认证 (all require the current password); changing the password revokes every other logged-in session.
- **Forgot password**: delete `dsh-webui-auth.json` in the data directory — a background check every minute disables authentication within at most 1 minute (no restart needed), then create a new account with a fresh setup token.

## Where data files live (depends on install mode)

Credentials and security data are stored in the **runtime data directory**, chosen automatically by install mode:

- **npm / GitHub / tarball installs**: the package lives inside `node_modules`, which is wholesale replaced on upgrade, reinstall or cleanup — so data is stored in a `.dsh-webui-auth/` directory **next to that `node_modules`** (usually the profile root, e.g. `~/.dsh/profiles/web/.dsh-webui-auth/`). Upgrading the plugin, `pnpm clean`, or reinstalling DSH no longer loses the account or login sessions.
- **Local link / source installs** (`dsh plugin add ./dsh-webui-oauth`): the plugin source directory itself (managed with the repo and excluded from git via `.gitignore`; deleting the whole source checkout is what deletes the data).
- **Fallback**: when none of the above is writable, `$DSH_HOME/dsh-webui-auth/` (default `~/.dsh/dsh-webui-auth/`) is used.

Upgrading from 0.3.x: runtime data is **not migrated automatically**. If the legacy data (inside the package directory or `~/.dsh/dsh-webui-auth/`) still exists, copy `dsh-webui-auth.json`, `sessions.jsonl`, `audit-hmac-key` and `audit.jsonl` from the table below into the new data directory manually (for npm / GitHub / tarball installs that is `.dsh-webui-auth/` next to `node_modules`); otherwise just recreate the account with a fresh setup token (see "Forgot password").

Files in the data directory:

| File | Purpose | Permissions |
|---|---|---|
| `dsh-webui-auth.json` | **Account credentials** (scrypt hash, v3 format; 0.2.x v2 credentials still verify and log in). Keeps the original filename so upgrades never lose accounts | — |
| `dsh-webui-oauth.json` | **This plugin's own config** (the OIDC section: `issuer` / `clientId` / `clientSecret` / `scope` / `redirectBase` / `trustBrowserOrigin`). A separate file keeps OIDC secrets apart from account credentials | — |
| `audit.jsonl` | Audit log (IPs pseudonymized, see "Audit log") | — |
| `sessions.jsonl` | Persisted sessions (restart recovery) | 0600 |
| `audit-hmac-key` | HMAC key for audit-IP pseudonymization (auto-generated once) | 0600 |
| `setup-token` | First-run setup token (deleted after setup succeeds) | 0600 |

The data directory is chosen by install mode (npm / GitHub / tarball → `.dsh-webui-auth/` next to `node_modules`; link / source → the plugin source directory; fallback `$DSH_HOME/dsh-webui-auth/`); the "forgot password", audit and session paths above refer to that data directory. You can also pin it explicitly with the `DSH_WEBUI_AUTH_DATA_DIR` environment variable (useful for containers and read-only package trees).

> **Upgrading from an older version (OIDC layout change)**: early builds stored the `oidc` section inside `dsh-webui-auth.json`; it now lives in `dsh-webui-oauth.json`. Reads still fall back to the old location (transparent upgrade), and the next save from the settings page migrates it to the new file while stripping the stale field from the credentials file.

## Audit log

Security events — login success/failure/rate-limit, setup, configure, disable, logout — are **appended as JSONL to `audit.jsonl`** in the data directory (timestamp, username, IP, user-agent, detail). **Client IPs are pseudonymized with HMAC-SHA256** (e.g. `hmac:5151e752|203.0.113.0/24`, with the /24 (IPv4) or /64 (IPv6) network prefix kept in cleartext for aggregation); raw addresses are never written to disk. Two ways to view:

- **CLI** (recommended): run `node index.js audit [--limit N]` (last 20 entries by default; run from the module path):
  ```sh
  node index.js audit --limit 50
  ```
- **Settings page**: Settings → 身份认证 → "最近登录记录" (Recent activity) shows the last 8 entries.

Audit write failures never block authentication (only a host-log warning).

## Appearance

Both the login page and the "Settings → 身份认证 (Authentication)" settings page follow DSH's **built-in appearance setting** (Settings → General → Appearance: Light / Dark / System); no separate appearance switch is provided. The settings page lives inside the WebUI and consumes DSH's theme tokens directly, so it tracks light/dark automatically. The login page is a standalone page: the server reads the current appearance preference (settings `ui-theme.preference`), injects it into the page, and the page mirrors DSH's boot logic — `System` resolves via `prefers-color-scheme` and reacts live to OS changes. The login response is served with `cache-control: no-store`, so a refresh picks up any appearance change immediately.

## What to do after upgrading DSH

**Nothing.** The plugin never modifies core packages — after a DSH upgrade the runtime route wrapping is re-applied automatically on startup. **On v0.1.2-alpha.2+** the plugin adapts to the `/api/remote.mux` event-stream route and cooperates with the core's built-in browser auth (launch-token ↔ signed cookie): after logging into the plugin, the browser is automatically guided through the core authentication, after which the WebUI works normally. If the wrapping is incomplete (DSH internals changed), the host log prints `ROUTE GATE INCOMPLETE`, the settings page shows a red warning, and `setup`/`configure` refuse to enable authentication (fail-closed).

> **Note (v0.1.2-alpha.2+)**: the core's browser auth requires the browser to first exchange the launch token for the core cookie (the `?token=` URL printed by `dsh web` / DSH Desktop). The plugin performs that exchange automatically; if a browser has never visited that address, open the full URL printed at DSH startup once (or log in via the plugin's login page — the exchange happens automatically).

## Data & Security

- Passwords are hashed with **scrypt** (Node's built-in memory-hard KDF — GPU/ASIC resistant, zero dependencies) and stored in `dsh-webui-auth.json` in the data directory (location depends on install mode, see above); plaintext is never written to disk. Credentials format is v3 (same scrypt encoding as v2 — only the version marker and field semantics changed); **0.2.x v2 credentials still verify**. **Since 0.2.0 only scrypt hashes are accepted**: 0.1.x SHA-256 credentials can no longer be verified — delete the credentials file and recreate the account (see "Forgot password").
- Login rate limiting: **per client IP**, at most 5 failures per minute — a single attacker can no longer lock out other users (or the operator). Behind a reverse proxy the client IP is taken from `CF-Connecting-IP` / the leftmost `X-Forwarded-For`, and the proxy headers are trusted **only when the socket peer is loopback** (local caddy/cloudflared) — remote callers cannot spoof them. Failed verifications also run a dummy scrypt pass so "unknown account" and "wrong password" take the same time, defeating username enumeration via response timing.
- First-run setup requires a **per-boot setup token** (128-bit, printed to the host log and written to `setup-token` in the data directory, mode 0600), preventing account claiming in the "exposed before configured" window.
- Audit log: `audit.jsonl`, client IPs pseudonymized with HMAC (see "Audit log").
- Persisted sessions: `sessions.jsonl` (0600), restored on restart; a write failure never affects authentication — the settings page just warns that a restart will require re-login.
- Security headers on the login page and API responses: strict CSP, `nosniff`, `DENY` framing, `no-referrer`, `noindex`, `no-store`.
- Cookie `HttpOnly + SameSite=Lax`: not readable by JS, not sent on cross-site requests.
- The login/setup endpoints are intentionally public (the entry point of authentication): `/dsh-webui-oauth/login` and `/dsh-webui-oauth/setup` (the latter protected by the setup token).
- **OIDC SSO**: authorization-code + PKCE + client_secret (confidential client, no public-client PKCE); state guards CSRF, nonce guards replay, redirect_uri is exact-matched (base + fixed path), id_token is JWKS-verified with iss/aud/exp/iat/nbf/nonce checks, and only HTTPS endpoints are accepted. Only the `sanitizeSub`-filtered `sub` is recorded in the audit log. The OIDC client config (including the secret) lives in `dsh-webui-oauth.json` in the data directory, kept apart from the account credentials.

## Signature algorithm support (id_token verification)

| Family | Algorithms | JWKS `kty` | Status |
| --- | --- | --- | --- |
| RSA | RS256 / RS384 / RS512 | `RSA` | ✅ |
| RSA-PSS | PS256 / PS384 / PS512 | `RSA` | ✅ |
| **ECDSA** | **ES256** (P-256) / **ES384** (P-384) / **ES512** (P-521) | `EC` | ✅ |
| EdDSA | Ed25519 | `OKP` | ✅ |

**EC support is fully working, not merely documented.** All three curves are verified with real signatures:

- **Unit level** (`test/oidc-ec.test.mjs`, 16 assertions): each curve generates a native key and signs for real → verification passes; a tampered payload or a foreign-key forgery → rejected; JWKS lookup by `kid` selects the EC key; and it still works when the JWKS **omits `alg`** (some IdPs do).
- **End to end**: a purpose-built IdP signed id_tokens with ES256 / ES384 / ES512 respectively, each driven through the full authorization-code + PKCE flow — all three logged in successfully (audit `oidc_login_success`).

**Implementation note**: an ECDSA JWT signature is JOSE raw `R||S` (ieee-p1363), whereas Node's `crypto.verify` **parses DER by default**. Without an explicit `dsaEncoding: 'ieee-p1363'`, ES384/ES512 simply fail to verify, while ES256's shorter curve means the occasional mis-parse can appear to pass — an extremely hard bug to chase. This plugin handles that path explicitly and covers it with regression tests.

**Algorithm-confusion protection (hardened in 0.5.0)**:

1. **The verification algorithm comes only from the token header; the JWKS `alg` is merely a consistency constraint.** The earlier code read `(jwk.alg || header.alg)`, and since virtually every IdP writes `alg` in its JWKS, that let `jwk.alg` override `header.alg` and made the header field inert. Measured consequence: a token genuinely signed with a P-256 key still verified after relabelling the header `ES384`/`ES512` — "claims ES512, is actually P-256". It now takes `header.alg` as the single source of truth and rejects any conflict with `jwk.alg`.
2. **Algorithm names go through an explicit allowlist** (no more `startsWith` prefix matching). Previously fabricated names like `ES999`/`RS999` could select a key of the matching `kty` — blocked today by an upper-layer allowlist, but that meant resting security on "another function happens to catch it".
3. **`kty` is still checked after a `kid` hit**, a mismatch is rejected, and there is **no fallback to "pick any key"** (a named `kid` with no match returns `null` → `no-signing-key`).
4. **JWKS `use` / `key_ops` are validated**: an encryption-only key (`use=enc` or `key_ops=[encrypt]`) is never selected for verification.
5. **`alg=none` and `HS*` are rejected** (including a real forgery attempt that uses a public key as the HMAC secret).

Each item has regression tests; the cases for the first two are confirmed to fail reliably (7 FAILs) against the pre-fix build, so they are not vacuous assertions.

**Choosing an algorithm**: IdPs default to RS256 most of the time; if yours supports EC, ES256 produces shorter signatures and verifies faster, which suits mobile clients and high-throughput deployments.

## End-to-end test results (isolated instance)

Measured on an isolated dsh instance (its own `$DSH_HOME` and profile, fully separate from the production image) running this repository's plugin, against a **purpose-built minimal OIDC provider** (discovery / jwks / authorize / token, RS256 signing with PKCE S256 verification).

### A. Local account flow

| Step | Request | Measured result |
| --- | --- | --- |
| Unauthenticated `/` | GET | **302 → /dsh-webui-oauth/login** (gate active) |
| Unauthenticated `/api` | GET | **401** |
| Login page | GET `/dsh-webui-oauth/login` | **200** (the only public page) |
| Wrong setup token | POST `/setup` | `{"ok":false,"error":"setup-token-required"}` |
| Weak password | POST `/setup` | `{"ok":false,"error":"weak-password","reason":"length"}` |
| Correct setup token | POST `/setup` | `{"ok":true}` + `dsh_wua_session` cookie (HttpOnly; SameSite=Lax; Max-Age=43200) |
| Repeat setup | POST `/setup` | `{"ok":false,"error":"already-configured"}` |
| Wrong password | POST `/login` | `{"ok":false,"error":"invalid"}` |
| Correct password | POST `/login` | `{"ok":true}` + session cookie |

**The two-cookie handoff (important)**: with a plugin session, visiting `/` returns a 302 to the core's launch-token URL (`/?token=…`) so the browser completes the core's own `dsh-auth-*` cookie exchange. Measured:

- `/api` with only the plugin cookie → **401** (the core has not claimed this browser yet);
- `/api` after the token exchange → **404** (authenticated; the path simply does not exist).

The plugin gate and the core's BrowserAuth are **two independent doors** — both are required. This is by design, not a fault.

### B. OIDC / SSO flow

Run end-to-end against a minimal IdP (`https://127.0.0.1:14443`, self-signed CA):

1. `GET /dsh-webui-oauth/oidc/login?base=<browser origin>` → **302** to the IdP `/authorize`, carrying `code_challenge` + `code_challenge_method=S256`, and setting the `dsh_wua_oidc_state` cookie (HttpOnly, 600s);
2. the IdP validates client_id / response_type / PKCE, then **302**s back to `redirect_uri?code=…&state=…`;
3. `GET /dsh-webui-oauth/oidc/callback` → the plugin exchanges the code with its `code_verifier`, verifies the id_token signature → **200** plus a session cookie, clearing the state cookie;
4. the audit log records `oidc_login_success` with the IdP `sub` (measured: `lab-user-001`).

The IdP log confirms the full round trip: `discovery → jwks → authorize (issued code) → token (issued id_token)`.

Security properties verified (all correctly rejected):

| Attack | Measured |
| --- | --- |
| Mismatched state | `{"ok":false,"error":"oidc-invalid-state"}` |
| Missing state cookie (login CSRF / session fixation) | `{"ok":false,"error":"oidc-invalid-state"}` |
| Authorization-code replay | `{"ok":false,"error":"oidc-invalid-state"}` |

### C. Redirects when a reverse proxy rewrites Host (the important part)

Preconditions: **no** `remote-web-ui.publicBaseUrl` configured, `trustBrowserOrigin` at its default `true`. Assume the browser really talks to `http://127.0.0.1:14080` while the proxy rewrites Host to the loopback `127.0.0.1:13081` (Caddy's default behaviour).

| Scenario | Redirect the plugin emits | Correct? |
| --- | --- | --- |
| 1. Direct (Host=13081) | `http://127.0.0.1:13081/?token=…` | ✅ |
| 2. Host rewritten **+ X-Forwarded-Host=14080** | `http://127.0.0.1:14080/?token=…` | ✅ |
| 3. Host rewritten + XFH=public.example:8443 + X-Forwarded-Proto=https | `https://dsh.example.com:8443/?token=…` | ✅ |
| 4. Host rewritten **and no XFH** | `http://127.0.0.1:13081/?token=…` | ❌ points at the internal port |

**Conclusion**: when a proxy rewrites Host and does **not** forward the original host header, no correct redirect can be derived without a configured `publicBaseUrl` — the server has no browser-side address at all, and guessing would amount to an open redirect. The browser is sent to `127.0.0.1:13081`; if that port is internal/unexposed the symptom is "login succeeds but the page will not open".

**Two fixes, pick either**:

- Have the proxy forward the original host header (recommended, least configuration):
  ```nginx
  proxy_set_header X-Forwarded-Host $host;      # or $http_host to include the port
  proxy_set_header X-Forwarded-Proto $scheme;
  ```
  Caddy forwards `X-Forwarded-Host` by default; if you preserve Host instead (e.g. a `DSH_PRESERVE_HOST`-style switch), the case collapses into "direct" and is equally correct.
- Or declare the public address explicitly in `settings.yaml`:
  ```yaml
  remote-web-ui:
    publicBaseUrl: 'https://dsh.example.com:8443'
  ```
  Note that `publicBaseUrl` is **only honoured when its authority matches the request Host** (to prevent an open redirect). When Host has already been rewritten to loopback the two do not match, so **`publicBaseUrl` cannot rescue this case either** — you must use the first option. This is an easy misconfiguration, hence documenting it here.

  You also need `--trusted-host <public host:port>`, otherwise a desktop browser hitting `/api` directly gets 403 (see "Known limits").

## Known limits

- **Inherent runtime-wrapping window**: between a route-object replacement (service hot-reload) and the next rescan (≤10s) there is an unprotected window; the fail-closed check on enabling covers the "initially exposed" case, so this window only affects hot-reload during runtime.
- **WebSocket and `trustedHosts`**: in reverse-proxy / LAN deployments (non-loopback Host), WS downlinks need the public hostname added to `client-connection.trustedHosts` in the DSH config (see "Architecture").
- **Proxy on a different host**: if the reverse proxy is not on the same machine as DSH (non-loopback peer), the proxy headers are not trusted and rate limiting aggregates per proxy IP (degrades to a global bucket).
- **HTTPS proxy that sends no protocol header**: the post-login redirect scheme depends on ① `remote-web-ui.publicBaseUrl` or ② an `X-Forwarded-Proto` / `Forwarded` header from the proxy. With neither, it can only fall back to `http` (the browser then handshakes against the TLS port and the page looks frozen after clicking Login). Pick one: declare the public address in `settings.yaml`, or make the proxy send `proxy_set_header X-Forwarded-Proto $scheme;`. Note `publicBaseUrl` only applies when it matches the request Host, which is what keeps LAN direct access from being rewritten to the public address.
- **Proxy rewrites Host without forwarding the original host header**: the server then has no browser-side address at all, so without a configured `publicBaseUrl` no correct redirect is possible (it points at the internal upstream port); and `publicBaseUrl` does not apply either, because its authority no longer matches. **The only workable fix is to have the proxy send `X-Forwarded-Host`** (Caddy does by default) or to preserve the original Host. See the measured table in section C of "End-to-end test results".
- **`--trusted-host` is not optional**: after desktop password login, requests that hit `/api` directly depend on `--trusted-host <public-host:port>`; the remote-web-ui pairing flow (`/remote` channel) does not. Dropping the flag makes every `/api` call return 403.
- **Limits of audit pseudonymization**: the HMAC key lives in the same data directory (0600); a local attacker who can read it can brute-force the IP space — pseudonymization protects against "plaintext IPs at rest", not against an attacker with file access.
- Sessions live in `sessions.jsonl`: they survive restarts (expiry unchanged); uninstalling/disabling the plugin does not affect credentials.
- Threat model is "browser/network clients": local processes that can read/write the host's memory or files are out of scope.
