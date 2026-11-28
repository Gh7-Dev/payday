# PLAN amendments (these override PLAN.md where they differ)

Order: S1, S2, S3, S5, S4, S6, S6b, S7, S8, S9, S10, S11, S12, S13. (S5 before S4: the estimator needs the chain interface.)
Every step: finish with `npm run check` passing, then `git commit -m "<step>"`. Final reply = files created, the check line, EXPLAIN (max 8 plain lines). Update LOG.md.

**All steps:** `npm run check` prints one line: `check: OK (N tests)` or `check: FAIL - <first failing test>`. No hardcoded counts; skipped tests (DEVNET) are not failures.

**S1** also creates: `.gitignore` (.env, *.db, node_modules), `.env.example` (names only, no values), `LOG.md`, `docs/DEPS.md` (each dependency: one-line reason, version, official doc URL, or "unverified"). `git init` if needed.

**S3** also: Kenya phone normalizer (07.., 01.., +254.., 254.. -> +254XXXXXXXXX, else null); amounts as decimal strings -> bigint base units (reject blank, negative, exponent, commas, too many decimals, above u64 max 18446744073709551615). Extra tests: duplicate phone or email, wrong column count, BOM and CRLF, quoted comma, explicit 0 allowed.

**S5** (backend-only interface): `getRentExempt(bytes)`, `getFeePerSignature()`, `getProgramme()`, `getVaultBalance()`, `isTrainerRegistered(wallet)`, `enroll(trainee, amounts)`, `topUp(wallet)`. `createProgramme`, `fund`, `addTrainer` are signed by the organizer's wallet in the browser, so they are NOT on the interface; the mock exposes them only as test helpers. Mock errors mirror section 7.3 of the design.

**S4**: rent and fee come from the S5 interface, never hardcoded. Config also holds: demo-mode `start_ts` and `day_len` overrides (a demo start must be in the future), Kenya-midnight conversion (UTC+3), trainer top-up amount, total top-up cap, optional rates. Tests with mock rent `(bytes+128)*5080` must give: programme 168 bytes = 1,503,680; trainer 73 bytes = 1,021,080; vault 165 bytes = 1,488,440; 5-day enrollment 129 bytes = 1,305,560; per participant = 2,794,000 lamports. Trainer top-ups are their own line; the combined figure is null without rates.

**S6b (NEW) organizer endpoints** (session required): create event (name, dates; start_ts via Kenya midnight or the demo override); add trainers (name, phone), allowed any time; upload trainee CSV (uses S3); issue trainee link (refused until the programme exists and the vault is funded, read through the chain interface) and trainer link; event status. Tests: no session gives 401; trainee link refused before funded; trainers addable after creation.

**S7**: the 2-hash limit queues with a bounded wait; it does not refuse. Set scrypt `maxmem` as needed (verify in the Node docs). Tests: hash/verify, never more than 2 at once, per-IP and per-phone blocks.

**S8** extra tests: enroll failure leaves the row `pending` and a retry succeeds; claim refused before funded; a second wallet for the same row is rejected; two concurrent claims on one row, exactly one wins; `enrolled` is set only after enroll succeeds.

**S9**: trainer state `registered` is set only by the backend after `isTrainerRegistered` is true, never by the trainer. Top-up happens once per listed phone and stops at the config total cap; tests for both. Trainer link is rate-limited per IP.

**S10**: program ID comes from config; reject non-base64 and size above 1232 bytes; TTL 60 s checked at GET.

**S11**: start only when the Anchor IDL exists; read the IDL, invent no fields; keep the payer abstract until then; skipped (not failed) without `DEVNET=1`.

**Agent per step:** Gemini 3.8 Flash (low): S1, S2, S3, S4, S6b, S7, S9, S10, S12, S13. Claude Sonnet 4.6 Thinking (medium): S5, S6, S8, S11. A Flash step that fails twice goes to Sonnet.
