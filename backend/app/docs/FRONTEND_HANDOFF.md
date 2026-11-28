# PayDay frontend handoff (28 Nov 2026)

## 1. What PayDay is
PayDay pays training and event stipends only for days a participant attended. Each check-in needs a trainer signature and a participant signature. Money sits in a vault owned by the Solana program; nobody holds a key to it. Unpaid money returns to the organizer after the event.

Honest claim (must appear in the UI footer, README and pitch): PayDay does NOT prove physical presence. It makes each attendance claim public, two-signed and auditable. Never say "first". Never say "non-custodial": the server sees trainee PINs and trainer passwords (scrypt-verified) and stores encrypted key blobs. The PIN limits online guessing only.

Hackathon: Dev3pack Global Hackathon, ends 29 Nov 2026. Devnet and a test token only.

## 2. What exists (backend, done)
- Solana program (Anchor): create_programme, fund, add_trainer, enroll, check_in, reclaim. All six run on Devnet. A real run passed 22 of 22 checks, including a trainee wallet with 0 SOL signing a check-in while the trainer pays the fee.
- Backend (Node, TypeScript, Hono, SQLite): wallet-signature login, organizer endpoints, trainer signup and unlock, trainee claim and unlock with PIN limits, check-in relay, config, chain-status. 138 tests passing.
- API contract: docs/PayDay_API_v2.md. READ IT FIRST. It lists every endpoint, error code, the account order and PDA seeds for browser-side chain calls.

## 3. Not yet proven (the frontend will find any bugs)
1. The relay with a real check-in transaction (only mocks so far). Build it exactly as section 7 of the API doc.
2. The whole HTTP flow on the real chain: trainer signup, sync, claim, relay.

## 4. Roles and screens
Organizer (desktop-first):
1. Connect wallet, sign the login message (base58 signature), see /auth/me.
2. Create event (name, dates, day length, decimals, token mint, max participants).
3. Upload CSV (name,email,phone,day1..dayK), show perDayTotals and grandTotal; show validation errors (max 20).
4. Add trainers (name, phone).
5. Create programme and fund the vault in the browser (backend_key from /config), then add_trainer on chain per trainer, then POST /events/:id/trainers/sync.
6. Create trainee and trainer links. The raw link code is shown ONCE in the response; display it immediately with a copy button.
7. Status page from GET /events/:id and /events/:id/chain-status (phase, vault balance, current day, reclaimable). Reclaim button when reclaimable.

Trainer (phone-first): open link, sign up (username, phone, password; the browser creates the keypair and encrypts it with the password), unlock, scan a trainee QR, build and sign the check_in transaction, POST /relay, show the returned id as a QR with a visible 60-second countdown.

Trainee (phone-first): open link, claim (phone, 6-digit PIN; the browser creates the keypair and encrypts it with the PIN), show wallet QR, on check-in scan the trainer QR, GET /relay/:id, DECODE and verify the transaction (program id, instruction is check_in, own pubkey, correct day), unlock the key with the PIN, sign, send to Solana RPC. The trainee wallet needs no SOL. Cache the wallet address in the browser after claim; /claim/unlock needs the PIN.

Audit page (cut first if short on time): totals locked, paid and returned per programme, readable without a wallet. Aggregates only; link to Solana Explorer (devnet) for the rest.

## 5. Technical decisions
- Stack: Vite, React, TypeScript. Use @solana/web3.js ^1.99 (same as the backend), wallet-adapter for the organizer (Phantom), tweetnacl for keypairs, WebCrypto (PBKDF2 plus AES-GCM) for the PIN and password encryption. Output must be base64 and at most 2048 characters for trainees.
- Same-origin API: every call is fetch('/api/...', {credentials:'include'}). Netlify proxies /api/* to the backend with a _redirects line: `/api/*  https://YOUR-BACKEND.onrender.com/:splat  200`. Do not use SameSite=None.
- Keep the IDL file in src (copy of the backend's payday.idl.json). Take the discriminators from it. Do not use the IDL's TypeScript client; build instructions by hand like scripts/devnet-checkin.ts does. That script is the reference for the check_in account order and signing.
- Enrollment PDA seeds are ["enrollment", trainee, programme], trainee FIRST.
- Demo mode: days can be about 90 seconds. Show a live "day N of M" from chain-status.
- Demo order: create and fund the programme, set PROGRAMME_ADDRESS on the backend, restart it, then trainers, links and claims.
- QR: any small QR library to show; a camera scanner library to scan. Provide a paste-the-code fallback in case the camera fails.
- Errors: map backend and program error codes to short plain-English messages (list is in the API doc).

## 6. Design direction
Goal: a calm, confident, modern product that looks designed by a person, not generated.
- Layout: generous whitespace, a clear grid, one strong headline per screen, thin 1px borders instead of heavy shadows.
- Colour: warm off-white background, near-black ink text, ONE accent colour (deep green or terracotta) used only for primary actions and status. No purple-blue gradients, no glow, no glassmorphism.
- Type: a refined serif for headings (for example Fraunces or Instrument Serif) with a clean sans for UI (Inter or Geist). Tabular numerals for money.
- Motion: almost none. Simple 150ms fades on state changes. No pulsing or blinking dots, no animated gradients, no confetti, no typing effects.
- Icons: a single thin line-icon set, used sparingly. No emoji.
- Copy: plain and specific ("Vault holds 800,000 units"), not marketing language. No "revolutionary" or "seamless".
- Tables: clean, aligned right for numbers, status shown as a small text label, not a coloured pill with a dot.
- Mobile: trainer and trainee screens are designed for a phone first, with big tap targets and one action per screen.
- Landing: short, with the honest claim and a three-step explanation (fund, check in, reclaim). The organizer app lives behind it.

## 7. Build order
1. Skeleton, same-origin proxy, organizer wallet login.
2. Event, CSV, trainers, links.
3. Create and fund the programme, add_trainer, sync.
4. Trainee claim; trainer signup and unlock.
5. Check-in handshake (riskiest, test early).
6. Chain-status view, reclaim, polish.
7. Audit page and landing (cut if short on time).
Never cut: create and fund, claim, check-in with payment, reclaim, README with the devnet address, demo video.

## 8. Rules
- Secrets only in .env files, never committed. Netlify and Render environment variables hold deployed values.
- No Claude or Anthropic attribution in git commits or PR descriptions.
- Do not claim PayDay proves presence, is non-custodial, or is first.
- If stuck on one problem for over 90 minutes, simplify.
