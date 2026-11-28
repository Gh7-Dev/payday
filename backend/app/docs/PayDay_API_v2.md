# PayDay backend API v2 (28 Nov 2026)

Base URL: http://localhost:8787 (PORT env). Bodies are JSON unless noted.
Errors: HTTP status plus {"error":"<code>","message"?}. Wallets are base58 public keys. Amounts are decimal strings (base units). Times are unix seconds.
Status: every shape below comes from the code or a Devnet run. Items marked CONFIRM need one quick check by the frontend developer.

## 0. Deployment facts
- Cookie `session`: HttpOnly, SameSite=Lax, Path=/, Max-Age 43200 (12 h). It is `Secure` unless env COOKIE_SECURE=false. Use COOKIE_SECURE=false for plain http on localhost.
- Frontend must call fetch with credentials:'include'. CORS allows only origins in ALLOWED_ORIGINS.
- SameSite=Lax needs frontend and backend on the same site. For the demo, serve both behind one origin (reverse proxy) or run both locally. Different domains would need SameSite=None; Secure (code change).
- The backend reads ONE programme from env PROGRAMME_ADDRESS. Demo order: create and fund the programme from the browser, set PROGRAMME_ADDRESS, restart the backend, then run trainers, links and claims.
- The server sees the trainee PIN and trainer password (verified with scrypt). Do not describe PayDay as non-custodial.

## 1. Public
- GET /health -> {status:"ok"}
- GET /config -> {chain:"mock"|"real", cluster:"devnet", programId, backendKey}. The organizer must pass `backendKey` as `backend_key` to create_programme. Any other key makes every enroll fail with InvalidBackend.

## 2. Organizer login
1. POST /auth/nonce {wallet} -> 200 {nonce, message, expiresAt}. expiresAt is unix seconds. Errors: invalid_json, wallet_required, invalid_wallet (all 400).
2. Sign `message` exactly as returned (it is "PayDay login\nWallet: <wallet>\nNonce: <nonce>\nExpires: <ISO-8601 UTC>" with real newlines). Use the wallet's signMessage on the UTF-8 bytes. CONFIRM: detached ed25519 signature over those bytes.
3. POST /auth/verify {wallet, signature} -> 200 {ok:true, wallet} and sets the cookie. `signature` is BASE58 of the 64-byte signature. Errors: wallet_required, signature_required (400), invalid_signature (401).
- Up to 5 live nonces per wallet are kept. Request a fresh nonce if verify fails.
- GET /auth/me -> 200 {wallet}, or 401 {error:"unauthorized"}.

## 3. Organizer endpoints (cookie required, else 401 unauthorized)
- POST /events {name, startDate "YYYY-MM-DD", endDate, dayLenSeconds, decimals:number, tokenMint, maxParticipants:number} -> 201 event row (id, name, programme_id, start_ts, day_len_seconds, days, max_participants, decimals, token_mint, status "draft", ...). Errors (400): invalid_json, name_required, dates_required, invalid_decimals, invalid_max_participants, invalid_date_format, end_date_before_start_date, days_out_of_range (1 to 31). In demo mode the server config overrides start_ts and day length.
- POST /events/:id/trainers {name, phone} -> 201 {id, eventId, name, phone (normalised +254...), state:"invited"}. Errors: 404 not_found, 400 invalid_json / name_required / phone_required / invalid_phone, 409 duplicate_phone.
- POST /events/:id/participants/csv (Content-Type text/csv, raw body) -> 200 {ok:true, count, perDayTotals:[string], grandTotal:string}. CSV header: name,email,phone,day1..dayK with K = min(days, 7); no role column. The 7-day pattern repeats up to the event's days. Errors: 400 {ok:false, errors:[...]} (at most 20), 409 participants_already_claimed once claims started, 404 not_found.
- POST /events/:id/links {type:"trainee"|"trainer"} -> 201 {linkId, eventId, type, code}.
  - `code` is the raw link code and is shown ONLY in this response (only its hash is stored). Display it immediately.
  - type "trainee": 409 programme_not_created if no programme on chain; 409 vault_underfunded if the vault holds less than the CSV total; on success it sets event status "funded". There is no register-programme endpoint.
  - 400 invalid_type; 404 not_found.
- GET /events/:id -> {event, trainers:{invited,signed_up,funded,registered}, participants:{unclaimed,pending,enrolled}}
- POST /events/:id/trainers/sync -> {registered, pending}. Run it after the organizer's add_trainer transactions confirm. It moves trainers to "registered".
- GET /events/:id/chain-status -> {phase, programme|null, vaultBalance|null, currentDay|null, endTs|null, reclaimable}. phase is one of not_created, not_started, running, ended, reclaimed. bigints are strings. Errors: 502 chain_unavailable. currentDay = floor((now - startTs) / dayLen), 0-based (checked against the program source).

## 4. Trainer (no cookie)
- POST /trainer/signup {linkCode, username, phone, password, wallet, encryptedKeyBlob} -> 200 {state}. The browser creates the keypair and encrypts it with the password. The first signup tops up the wallet with SOL for fees (once, within a cap). States: invited, signed_up, funded, registered.
  Errors: bad_request 400, unknown_link 404, bad_credentials_format 400, bad_wallet 400, bad_blob 400, not_on_list 404, already_signed_up 409, duplicate_entry 409, invalid_state 409, wrong_password 401, topup_cap 409, busy 503, too_many_attempts 429, or a chain error code with 502.
- POST /trainer/unlock {linkCode, username, password} -> 200 {wallet, encryptedKeyBlob, state}. Errors: bad_request 400, unknown_link 404, not_found 404, invalid_state 409, wrong_password 401, busy 503, too_many_attempts 429.
- A trainer becomes "registered" only after the organizer's add_trainer transaction is confirmed and /events/:id/trainers/sync has run.

## 5. Trainee (no cookie)
- POST /claim {linkCode, phone, pin (6 digits), wallet, encryptedKeyBlob (base64 charset, max 2048)} -> 200 {state:"enrolled"}. The browser creates the keypair and encrypts it with the PIN. The backend stores the blob, then enrolls the wallet on chain (backend signs and pays). A trainee wallet needs NO SOL (proven on Devnet).
  Errors: bad_request, too_many_attempts 429, unknown_link 404, not_funded 409, not_on_list 404, bad_pin_format 400, bad_wallet 400, bad_blob 400, already_claimed 409, wallet_in_use 409, wrong_pin 401, busy 503, or a chain error code with 502 (InsufficientFunding, ProgrammeFull, BackendUnderfunded, ...).
  Safe to retry after a 502: the claim stays "pending" and enroll is idempotent.
- POST /claim/unlock {linkCode, phone, pin} -> 200 {wallet, encryptedKeyBlob}. 409 not_enrolled until enrolled.

## 6. Check-in handshake (relay)
1. Trainer browser: unlock key (/trainer/unlock), build the check_in transaction (section 7), set feePayer = trainer, sign as trainer (first signature), serialize without requiring all signatures, base64.
2. POST /relay {eventId, tx} -> 201 {id, expiresAt}. tx is base64, at most 4000 chars. Errors: relay_not_configured 503, bad_request 400, bad_tx 400, too_large 413, wrong_program 400, bad_signature 400 (first signature missing or invalid), trainer_not_registered 403, unknown_event 404, busy 429/503. Show `id` as a QR.
3. Trainee browser: GET /relay/:id -> 200 {tx, expiresAt, secondsLeft}. Errors: 404 not_found, 410 expired. Lifetime is about 60 s (RELAY_TTL_SECONDS); on expiry the trainer rebuilds with a fresh blockhash and re-posts.
4. Trainee browser DECODES the transaction and checks: program id equals /config programId, instruction is check_in, its own pubkey is the trainee signer, and `day` equals the current day. Then it unlocks its key with the PIN (/claim/unlock), signs, and sends the fully signed transaction to Solana RPC itself. The backend never signs it.

## 7. Browser-side chain calls (proven on Devnet, 28 Nov 2026)
Instruction data = 8-byte discriminator from the IDL + arguments (little-endian). Accounts in this exact order. S = signer, W = writable.
- create_programme(programme_id u64, backend_key pubkey, start_ts i64, day_len i64, days u8, max_participants u16): organizer (S,W), programme PDA (W), vault PDA (W), mint, token program, system program. backend_key = /config backendKey.
- fund(programme_id u64, amount u64): organizer (S), programme (W), organizer token account (W), vault (W), mint, token program.
- add_trainer(programme_id u64): organizer (S,W), programme (W), trainer wallet, trainer PDA (W), system program.
- check_in(day u8): trainer (S), trainee (S), programme (W), trainer PDA, enrollment PDA (W), vault PDA (W), trainee token account (W), mint, token program. Trainer is fee payer and first signer.
- reclaim(): organizer (S), programme (W), vault (W), organizer token account (W), mint, token program. Allowed once now >= start_ts + days x day_len.
PDA seeds (programId from /config):
- programme: ["programme", organizer, programme_id as u64 LE]
- vault: ["vault", programme]
- trainer: ["trainer", programme, trainer_wallet]
- enrollment: ["enrollment", trainee, programme]   (trainee FIRST)
- token accounts are associated token accounts (owner, token program, mint).
Rules: day must equal the current programme day and be below days; a second check-in for the same day fails (AlreadyCheckedIn); trainer must differ from trainee (TrainerIsTrainee); an unregistered trainer fails with Anchor AccountNotInitialized (no custom error name). The program emits no events; read account state instead.
Program errors: 6000 InvalidDays, 6001 InvalidDayLength, 6002 StartInPast, 6003 InvalidCapacity, 6004 Unauthorized, 6005 InvalidBackend, 6006 MathOverflow, 6007 ProgrammeClosed, 6008 ProgrammeFull, 6009 ZeroAmount, 6010 WrongScheduleLength, 6011 InsufficientFunding, 6012 TrainerIsTrainee, 6013 NotStarted, 6014 WrongDay, 6015 AlreadyCheckedIn, 6016 EventNotOver.

## 8. Known limits
- One programme per backend process (PROGRAMME_ADDRESS).
- Link codes cannot be recovered after creation; create a new link instead.
- Per-wallet payout history: read the enrollment account from RPC (no backend endpoint).
