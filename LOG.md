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
- Updated `npm run check` test runner parser.
