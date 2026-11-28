# PayDay frontend plan

Read first: HANDOFF.md (what and why), DESIGN.md (every colour, font and component; follow it exactly), ../backend/docs/PayDay_API_v2.md (endpoints and on-chain account order), ../backend/scripts/devnet-checkin.ts (working reference for building instructions).
Write only inside frontend/. Do not touch program/ or backend/. No Claude or Anthropic attribution in commits. Do not claim non-custodial or proof of presence.

## 1. Stack (kept light)
Vite, React 18, TypeScript. Plain CSS with variables, no CSS or UI framework, no state library, no router library (hash routing by hand).
Dependencies (verify each name and version before installing; mark any you could not verify in LOG.md):
- react, react-dom
- @solana/web3.js ^1.99 (same as backend)
- tweetnacl (keypairs and signatures), bs58 (login signature encoding)
- buffer (Vite polyfill: set `define: { global: 'globalThis' }` and `window.Buffer = Buffer` in main.tsx)
- qrcode (draw QR) and qr-scanner (camera scan; needs https or localhost)
- @fontsource-variable/fraunces, @fontsource-variable/inter
Organizer wallet: use Phantom's injected `window.solana` (connect, signMessage, signAndSendTransaction) directly, no wallet-adapter packages. If Phantom is missing, show a notice with a link to install it.
Dev: vite dev server proxies `/api` to http://localhost:8787 (strip the `/api` prefix). Production: public/_redirects holds `/api/*  https://YOUR-BACKEND.onrender.com/:splat  200`. Every call is `fetch('/api/...', { credentials: 'include' })`.

## 2. Files (flat, one job each)
    index.html, vite.config.ts, tsconfig.json, package.json
    public/_redirects
    src/main.tsx            polyfills, font imports, styles, mount
    src/App.tsx             hash router: screen switch by route
    src/styles.css          tokens from DESIGN.md, base, components (one file)
    src/idl/payday.idl.json copy of ../backend/src/chain/payday.idl.json
    src/lib/api.ts          fetch wrapper, typed endpoint functions, error mapping
    src/lib/chain.ts        PDAs, instruction builders (create_programme, fund, add_trainer, check_in, reclaim), RPC helpers, programme account decode
    src/lib/keys.ts         keypair create, encrypt/decrypt blob, local cache
    src/lib/errors.ts       backend and program error code -> plain sentence
    src/lib/format.ts       amounts with decimals, short addresses, time
    src/ui.tsx              Button, Field, Card, Table, Stat, Notice, Modal, DayStrip, Qr, Countdown, Copy
    src/screens/Landing.tsx
    src/screens/Organizer.tsx   login + event list + event page with sections (one file, sections as functions)
    src/screens/Trainer.tsx     signup/unlock, scan, build, relay QR
    src/screens/Trainee.tsx     claim, wallet QR, check-in scan, status
    src/screens/Audit.tsx       cut first

## 3. Routes
    #/                              Landing
    #/organizer                     login, then event list
    #/organizer/<eventId>           event page
    #/trainer/<eventId>/<code>      trainer link
    #/join/<eventId>/<code>         trainee link
    #/audit/<programmeAddress>      audit page (optional)
The organizer UI builds the trainer and trainee links with the event id in the URL, because the trainer and trainee have no other way to learn it and /relay needs it.

## 4. Screen action -> endpoint or instruction
    Organizer connect + sign in   POST /auth/nonce, sign message (UTF-8) with Phantom, base58-encode signature, POST /auth/verify, GET /auth/me
    Create event                  POST /events
    Upload CSV                    POST /events/:id/participants/csv (text/csv)
    Add trainer                   POST /events/:id/trainers
    Create programme (browser)    create_programme, backend_key from GET /config
    Fund                          fund
    Register trainer on chain     add_trainer, then POST /events/:id/trainers/sync
    Make links                    POST /events/:id/links {type}; show raw code once in Modal
    Status                        GET /events/:id, GET /events/:id/chain-status
    Reclaim                       reclaim (button only when reclaimable)
    Trainer signup                POST /trainer/signup
    Trainer unlock                POST /trainer/unlock
    Trainee claim                 POST /claim
    Trainee unlock for signing    POST /claim/unlock
    Relay post / fetch            POST /relay, GET /relay/:id
    Trainee sends check-in        Solana RPC sendRawTransaction

## 5. Key handling
- Create a Keypair with tweetnacl in the browser. Never send the secret key anywhere unencrypted.
- Encrypt the 64-byte secret key with WebCrypto: PBKDF2-SHA256 (600000 iterations, random 16-byte salt) from the PIN or password, AES-GCM with a random 12-byte IV. Blob = salt(16) + iv(12) + ciphertext(80), base64. About 144 characters, under the 2048 limit.
- Cache in localStorage only: the wallet public key, role, eventId and link code. Never the secret key or PIN. To sign, call the unlock endpoint, decrypt, sign, then drop the key from memory.
- Trainee screen: show wallet QR from the cached public key without any PIN. Ask for the PIN only when signing a check-in.

## 6. Check-in handshake
Needs the programme address, mint, start time and day length in the browser (see section 8, task 0).
1. Trainer unlocks, scans the trainee wallet QR (the QR text is the base58 public key; offer paste fallback).
2. Trainer computes `day = floor((now - startTs) / dayLen)`, builds check_in (account order from the API doc section 7), feePayer = trainer, fresh blockhash, partial-signs, serialises with requireAllSignatures false, base64.
3. POST /relay {eventId, tx}. Show the returned id as a QR with the Countdown (60s).
4. Trainee scans the id (paste fallback), GET /relay/:id, decodes the transaction, checks: program id equals /config programId, instruction discriminator is check_in, own public key is the second signer, day equals the current day. If any check fails, show a Notice and stop.
5. Trainee enters the PIN, unlocks, adds the second signature, sendRawTransaction, confirms, shows "Paid X units for day N".

## 7. Task list (one task per prompt; each ends with a short verdict you can read)
0. Backend (owner approves, done outside this folder): expose programmeAddress, mint, startTs, dayLen, days publicly (extend /config or add GET /programme).
1. Skeleton: Vite app, dependencies, Buffer polyfill, tokens in styles.css, fonts, hash router, /api proxy, _redirects. Done when `npm run build` passes and a blank styled page loads.
2. UI kit in ui.tsx plus a hidden #/kit route that shows every component. Done when it matches DESIGN.md at 375px and 1280px.
3. Landing page exactly as DESIGN.md composition. Done when it matches at both widths.
4. lib/api.ts, lib/errors.ts, lib/format.ts with a tiny test page or node test for format and errors.
5. Organizer login with Phantom. Done when /auth/me returns the wallet after sign-in.
6. Create event, CSV upload (show totals and up to 20 errors), add trainers.
7. Programme: create_programme, fund, add_trainer, sync. Done when chain-status shows phase running or not_started with the right vault balance. Reference: backend/scripts/devnet-checkin.ts.
8. Links with one-time Modal, status page with Stat blocks and DayStrip.
9. Trainee claim (keys.ts, POST /claim, cached wallet QR).
10. Trainer signup and unlock.
11. Check-in handshake, sections 6 above. Riskiest; test on real Devnet with 90-second demo days.
12. Reclaim, error polish, mobile pass, README of how to run.
13. Audit page (cut first).

## 8. Minimum demo path (if time runs out)
Tasks 0, 1, 2 (only the parts used), 5, 6, 7, 8, 9, 10, 11, 12. Landing (3) can be a simplified version; the audit page (13) can be Explorer links.

## 9. Cut list, first to last
Audit page, landing polish, DayStrip on the status page, CSV error table (show first 5), kit route, scanner camera (use paste fields only).

## 10. Open questions for the owner
- Deployed backend URL for _redirects.
- Test token decimals and mint address for default form values.
- Which Netlify site name to use.
