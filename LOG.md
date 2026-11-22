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
