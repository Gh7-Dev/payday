# PayDay Backend Build Log

## S1 - Project scaffold
- Initialized Node 22 TypeScript project under `app/`.
- Configured Hono web framework, TypeScript strict mode with `NodeNext` resolution, and Node test runner with `tsx`.
- Implemented `npm run check` printing `check: OK (N tests)` on pass or `check: FAIL - <test>` on failure.
- Created health check route (`GET /health`) returning 200 `{ status: "ok" }`.
- Added `.gitignore`, `.env.example`, `LOG.md`, and `docs/DEPS.md`.

## S2 - DB wrapper + schema
- Created SQLite database schema in `app/src/schema.sql` per design-v2 section 8 and S2 requirements (TEXT and INTEGER only, TEXT UUIDs, unix seconds as INTEGER, JSON array strings for amounts, nullable `claim_code_hash`, `UNIQUE(event_id, phone_e164)` on trainers and participants, `UNIQUE(event_id, wallet_address)` on participants).
- Implemented `getDb` and `migrate` in `app/src/db.ts` using built-in `node:sqlite` (`DatabaseSync`) with `PRAGMA foreign_keys = ON;`.
- Wrote tests in `app/test/db.test.ts` verifying idempotency (migrate twice), unique phone per event constraint, claim state check constraint, and foreign key enforcement.

## S2b - Schema fix
- Added missing event fields (`organizer_wallet`, `start_ts`, `day_len_seconds`, `max_participants`, `decimals`, `token_mint`, `status` with check constraint).
- Updated trainers table (`name`, nullable `username`, unique `(event_id, username)`, nullable top-up columns) and participants table (`enroll_signature`, `claimed_at`).
- Added tests verifying all new constraints.

## S3 - CSV validator, money & phone normalizer
- Implemented `parseDecimalToBigInt` in `app/src/money.ts` handling decimal conversion to u64 base units with strict validation.
- Implemented `normalizeKenyaPhone` in `app/src/phone.ts` converting Kenyan numbers to E.164 `+254XXXXXXXXX`.
- Implemented `validateCsv` and `expandCycle` in `app/src/csv.ts` with `csv-parse`, returning rows and per-day / grand totals or up to 20 structured errors with stable lowercase error codes.
- Added comprehensive unit tests in `test/money.test.ts`, `test/phone.test.ts`, and `test/csv.test.ts`.

## S5 - Chain interface + mock
- Created backend-only `ChainInterface` and `ChainError` in `app/src/chain/interface.ts` (`getRentExempt`, `getFeePerSignature`, `getProgramme`, `getVaultBalance`, `isTrainerRegistered`, `enroll`, `topUp`).
- Implemented in-memory `MockChain` in `app/src/chain/mock.ts` with default rent formula `(bytes+128)*5080` and fee `5000`, along with test helpers (`createProgramme`, `fund`, `addTrainer`, `markReclaimed`).
- Wrote tests in `app/test/chain.test.ts` testing rent exemptions, funding requirements, duplicate/capacity constraints, schedule length checks, reclaim restrictions, trainer registration, and wallet top-ups.

## S4 - Cost estimator & config
- Implemented `src/config.ts` reading demo overrides (enforcing future demo start), top-up configurations, optional FX rates, and `kenyaMidnightUnix` calculating UTC+3 00:00:00 timestamp.
- Implemented `src/cost.ts` calculating separate line items: stipends, rent (via `ChainInterface`), fees, trainer top-ups, and optional combined USD estimate.
- Added tests in `test/cost.test.ts` verifying exact lamport values for accounts, sensitivity to mock rent changes, and rate behavior.

## S6 - Organizer auth (wallet-signature)
- Implemented `src/session.ts` and `src/routes/auth.ts` handling wallet signature authentication (ed25519 via `tweetnacl`).
- Note on signature encoding: `signature` accepted in POST `/auth/verify` is encoded in **base58** (`bs58`).
- Nonce storage in `sessions` table: max 5 active nonces per wallet, expired nonces cleaned up on nonce generation.
- Nonces are consumed only upon successful verification; failed verification leaves nonce usable until expiry.
- Session cookie uses `HttpOnly`, `SameSite=Lax`, and `Secure` by default (disabled only if `COOKIE_SECURE='false'`).

