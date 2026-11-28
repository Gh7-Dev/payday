# PayDay Backend – Build Plan (Node 22.21.0 · TypeScript · Hono · SQLite · Node test runner)

Cut order: S13 reminders first, S12 audit endpoints second. S11 is the only real-chain step.

| # | Goal | Key files | Tests (Node runner) | `npm run check` verdict |
|---|------|-----------|---------------------|-------------------------|
| S1 | Project scaffold | `app/package.json` `app/tsconfig.json` `app/src/index.ts` | health route → 200 (1 pass) | tsc 0 · 1 passed |
| S2 | DB wrapper + schema | `app/src/db.ts` `app/src/schema.sql` | open in-memory, assert tables (3 pass) | tsc 0 · 3 passed |
| S3 | CSV validator | `app/src/csv.ts` | blank→error, 0→ok, 10-day expand (5 pass) | tsc 0 · 5 passed |
| S4 | Cost estimator | `app/src/cost.ts` `app/src/config.ts` | 3 participants 5 days, correct line items (3 pass) | tsc 0 · 8 passed |
| S5 | Chain interface + mock | `app/src/chain/interface.ts` `app/src/chain/mock.ts` | enroll twice→error, fund→balance rises (4 pass) | tsc 0 · 12 passed |
| S6 | Organizer wallet-sig login | `app/src/routes/auth.ts` `app/src/session.ts` | nonce round-trip, bad sig rejected, cookie set (3 pass) | tsc 0 · 15 passed |
| S7 | Scrypt + attempt limiter | `app/src/scrypt.ts` `app/src/limiter.ts` | hash/verify, semaphore≤2, IP block (4 pass) | tsc 0 · 19 passed |
| S8 | Participant claim flow | `app/src/routes/claim.ts` | phone not on list, IP limit, idempotent retry (5 pass) | tsc 0 · 24 passed |
| S9 | Trainer sign-up + top-up | `app/src/routes/trainer.ts` | phone check, hash stored, login session (5 pass) | tsc 0 · 29 passed |
| S10 | Check-in relay | `app/src/routes/relay.ts` | wrong program ID rejected, TTL 60s, store+fetch (5 pass) | tsc 0 · 34 passed |
| S11 | Real chain module (swap) | `app/src/chain/real.ts` | devnet smoke (DEVNET=1 only) (1 pass) | tsc 0 · 35 passed |
| S12 | Audit endpoints *(cut 2nd)* | `app/src/routes/audit.ts` | aggregates returned, no names public (2 pass) | tsc 0 · 37 passed |
| S13 | Reminders *(cut 1st)* | `app/src/reminders.ts` | mock clock triggers, no crash (2 pass) | tsc 0 · 39 passed |

**EXPLAIN per step (each ≤ 8 lines; also update LOG.md at step end)**

S1: Hono + TypeScript strict, `npm run check = tsc --noEmit && node --test`. No DB or chain yet.
S2: One `db.ts` export; schema §8 (events, trainers, participants, claim_links, pending_checkins, sessions). Plain SQL, no ORM.
S3: Columns `name,email,phone,day1..dayK` (K≤7); blank cell error; "0" ok; repeats pattern to ≤31 days (§4 §8).
S4: Calls `chain.getRentExemption` (never hardcodes rent §9); config supplies top-up and FX rate; output labels combined figure as estimate (§6).
S5: TypeScript interface typed from §7.2 instructions; mock stores state in a Map; errors mirror §7.3. One import swap gives any route a real chain.
S6: Nonce in sessions table with expiry; ed25519 verify (tweetnacl); 32-byte random session token in httpOnly cookie. No scrypt (organizer has no password).
S7: scrypt cost 2^17 r=8 p=1 (§6); semaphore refuses >2 concurrent calls; in-process Map limiter for per-IP and per-phone counts.
S8: States unclaimed→pending→enrolled (§6 §8); checks vault funded via mock chain; key blob and PIN hash written to DB; only ciphertext stored.
S9: Trainer signs up via shared link; scrypt hashes password; key blob ciphertext only stored; states invited→signed_up→funded (§3 §8).
S10: POST stores half-signed tx if program ID and size ≤1232 match; short random ID returned; TTL 60s enforced at GET; no signing key held (§4a).
S11: Implements ChainInterface with @anchor-lang/core; backend key and fee-payer from env; devnet test opt-in (`DEVNET=1`); CI uses mock.
S12: Reads programme via chain interface; totals locked/paid/returned; anonymous labels only on public route (§8).
S13: setInterval checks DB for 7-day boundaries; placeholder log-line notification; on/off config flag; never blocks main loop (§8 §13).
