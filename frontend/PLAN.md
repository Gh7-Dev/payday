# PayDay frontend plan (final)

This is the only plan. Read first: HANDOFF.md, DESIGN.md (every colour, font and component; follow it exactly), ../backend/docs/PayDay_API_v2.md, ../backend/scripts/devnet-checkin.ts (working reference for instruction building and signing).
Write only inside frontend/. Do not touch program/ or backend/. No Claude or Anthropic attribution in commits. Do not claim non-custodial or proof of presence.

## 1. Stack (light)
Vite, React 18, TypeScript. Plain CSS with variables, no CSS or UI framework, no state library, hand-written hash routing.
Dependencies (verify each name and version before installing; list anything unverified in LOG.md):
- react, react-dom
- @solana/web3.js ^1.99 (same as backend)
- tweetnacl (keypairs), bs58 (login signature)
- buffer (polyfill). In vite.config.ts set `define: { global: 'globalThis' }`; in main.tsx set `window.Buffer = Buffer`. If the build still complains, switch to vite-plugin-node-polyfills.
- qrcode (draw), qr-scanner (camera; needs https or localhost)
- @fontsource-variable/fraunces, @fontsource-variable/inter
Organizer wallet: Phantom's injected `window.solana`: connect, signMessage for login, and signTransaction then connection.sendRawTransaction for chain calls (not signAndSendTransaction). No wallet-adapter packages. If Phantom is missing, show a Notice with an install link.
Dev: Vite proxies `/api` to http://localhost:8787 and strips the prefix. Production: public/_redirects with `/api/*  https://YOUR-BACKEND.onrender.com/:splat  200`. Every call is `fetch('/api/...', { credentials: 'include' })`.
Solana RPC: https://api.devnet.solana.com, overridable by VITE_RPC_URL.

## 2. Files (flat, one job each)
    index.html, vite.config.ts, tsconfig.json, package.json, LOG.md
    public/_redirects
    src/main.tsx             polyfills, fonts, styles, mount
    src/App.tsx              hash router
    src/styles.css           tokens from DESIGN.md, base, components
    src/idl/payday.idl.json  copy of ../backend/src/chain/payday.idl.json
    src/lib/api.ts           fetch wrapper and typed endpoint functions
    src/lib/chain.ts         PDAs, instruction builders (create_programme, fund, add_trainer, check_in, reclaim), RPC helpers
    src/lib/keys.ts          keypair create, encrypt/decrypt blob, local cache
    src/lib/errors.ts        backend and program error code -> plain sentence
    src/lib/format.ts        amounts with decimals, short addresses, time
    src/ui.tsx               Button, Field, Card, Table, Stat, Notice, Modal, DayStrip, Qr, Countdown, Copy
    src/screens/Landing.tsx, Organizer.tsx, Trainer.tsx, Trainee.tsx, Audit.tsx (cut first)

## 3. Routes
    #/                          Landing
    #/organizer                 login, then event list
    #/organizer/<eventId>       event page
    #/trainer/<eventId>/<code>  trainer link
    #/join/<eventId>/<code>     trainee link
    #/audit/<programmeAddress>  optional
The organizer UI builds the trainer and trainee links with the event id inside, because /relay needs the event id and trainers and trainees have no other way to learn it.

## 4. Public chain data
Trainer and trainee browsers read GET /config for programId, backendKey, programmeAddress, mint, startTs, dayLen and days (the last five are null until the programme exists; bigints are strings). Task 0 adds these to the backend.

## 5. Screen action -> endpoint or instruction
    Organizer sign in       POST /auth/nonce; Phantom signMessage on the UTF-8 message; base58-encode the signature; POST /auth/verify; GET /auth/me
    Create event            POST /events
    Upload CSV              POST /events/:id/participants/csv (text/csv)
    Add trainer             POST /events/:id/trainers
    Create programme        create_programme (programme_id = Date.now() as u64; backend_key from /config)
    Fund                    fund (organizer token account for the event's token mint)
    Register trainer        add_trainer, then POST /events/:id/trainers/sync
    Links                   POST /events/:id/links {type}; raw code shown once in a Modal
    Status                  GET /events/:id and /events/:id/chain-status
    Reclaim                 reclaim, only when reclaimable
    Trainer signup/unlock   POST /trainer/signup, POST /trainer/unlock
    Trainee claim/unlock    POST /claim, POST /claim/unlock
    Relay                   POST /relay, GET /relay/:id
    Trainee check-in        Solana RPC sendRawTransaction

After create_programme the UI must show the new programme address with a Copy button and this Notice: "Set PROGRAMME_ADDRESS to this address on the backend and restart it. Links and claims will not work until you do." Do not enable the link buttons until /config reports the same programmeAddress.

## 6. Key handling
- Create a Keypair with tweetnacl in the browser. The secret key never leaves the browser unencrypted.
- Encrypt the 64-byte secret key with WebCrypto: PBKDF2-SHA256, 600000 iterations, random 16-byte salt, then AES-GCM with a random 12-byte IV. Blob = salt(16) + iv(12) + ciphertext(80), base64, about 144 characters (limit 2048).
- localStorage holds only: wallet public key, role, eventId, link code, phone (trainee) or username (trainer). Never the secret key, PIN or password.
- Signing: call the unlock endpoint (trainee: linkCode, phone, PIN; trainer: linkCode, username, password), decrypt, sign, drop the key from memory. The 600000 iterations take about a second on a phone, so show "Unlocking..." text and nothing animated.
- The trainee wallet QR comes from the cached public key; no PIN until signing.

## 7. Check-in handshake
1. Trainer unlocks and scans the trainee's wallet QR (the QR text is the base58 public key; paste fallback).
2. Trainer computes day = floor((now - startTs) / dayLen) from /config. If the clock is within 3 seconds of a day boundary, warn and ask to retry. Builds check_in in the account order of API doc section 7, feePayer = trainer, fresh blockhash, partial-sign, serialise with requireAllSignatures false, base64.
3. POST /relay {eventId, tx}. Show the id as a QR with the Countdown (60s).
4. Trainee scans the id (paste fallback), GET /relay/:id, decodes, and checks: program id equals /config programId; instruction discriminator is check_in (from the IDL); own public key is the second signer; day equals the current day. Any failure shows a Notice and stops.
5. Trainee enters the PIN, unlocks, adds the second signature, sendRawTransaction, confirms, shows "Paid X units for day N".

## 8. Tasks (one per prompt; each ends with a short verdict line)
0. Backend (owner does this outside frontend/): /config exposes programmeAddress, mint, startTs, dayLen, days.
1. Skeleton: Vite app, dependencies, Buffer polyfill, tokens, fonts, hash router, /api proxy, _redirects. Done when `npm run build` passes and a styled blank page loads.
2. UI kit in ui.tsx plus a hidden #/kit route showing every component. Done when it matches DESIGN.md at 375px and 1280px.
3. Landing exactly as the DESIGN.md composition.
4. lib/api.ts, lib/errors.ts, lib/format.ts with a small node test for format and errors.
5. Organizer login with Phantom. Done when /auth/me returns the wallet.
6. Create event, CSV upload (totals and up to 20 errors), add trainers.
7. Programme: create_programme, fund, add_trainer, sync, with the PROGRAMME_ADDRESS notice. Done when chain-status shows the right vault balance.
8. Links with the one-time Modal; status page with Stat blocks and DayStrip.
9. Trainee claim (keys.ts, POST /claim, cached wallet QR).
10. Trainer signup and unlock.
11. Check-in handshake (riskiest). Test on real Devnet with 90-second days.
12. Reclaim, error polish, mobile pass, a short README of how to run. Then Audit page if time remains.

## 9. Minimum demo path
Tasks 0, 1, 2 (only components used), 4, 5, 6, 7, 8, 9, 10, 11, 12. Landing may be simplified; the audit page can be Explorer links.

## 10. Cut list, first to last
Audit page, landing polish, DayStrip on the status page, CSV error table (show first 5), kit route, camera scanning (paste fields only).

## 11. Open questions for the owner
- Deployed backend URL for _redirects.
- Test token decimals and mint address for form defaults.
- Netlify site name.
- Demo day length (90 seconds assumed) and whether backend restarts are done by hand.
