# PayDay system design report v2

Prepared for GH7, 20 Nov 2026; revised as v2 on 22 Nov 2026 (trainer model changed and review decisions applied; headings marked "(changed in v2)" differ from v1, everything else is unchanged). Status: design settled; program code in progress. Working name PayDay; clash check with other Solana projects still to do.

## 1. Purpose and honest claim

PayDay pays training and event stipends only for days a participant actually attended. Each check-in needs a trainer signature and a participant signature. Money is locked in a vault owned by the program, so no single person can withdraw it. Money for days that were not checked in goes back to the event organizer at the end.

Honest claim (must appear in the README and the pitch): PayDay does **not** prove physical presence. It makes every attendance claim public, two-signed and auditable, so fraud is attributable and leaves a trail a funder can check against sign-in sheets or spot checks. Never claim "first"; generic verifier-approves-vault-pays escrows exist.

## 2. Scope

**In scope:** stipend funding, locking, per-day payment, reclaim, participant claim flow, check-in handshake, cost estimate, basic views.

**Out of scope:** creating or managing events (an event can be created on Luma or elsewhere; PayDay only pays), cash-out or off-ramp to phone money (future work, to be named honestly), disputes, geofencing as a rule, screenshot blocking, passkey wallets, independent monitor role.

## 3. Roles (changed in v2)

| Role | What they do | Signs on chain |
| --- | --- | --- |
| Event organizer (also the funder) | Signs up, enters event details, the trainee list and the trainer list, funds the vault, registers trainers on chain, reclaims leftovers | create, fund, add trainer, update schedule, reclaim |
| Trainer | Any number per event. Signs up through the shared trainer link with username, phone and password; scans participant QR, signs the check-in and pays its fee by default | check-in |
| Participant | Claims place with phone and PIN, shows QR, enters PIN to check in | check-in |
| Backend key | One key held by the backend service, not a person. Enrolls claimed wallets | enroll only |
| Fee-payer wallet | Service wallet that pays SOL fees and rent on devnet and tops up each trainer wallet with a little SOL | nothing of its own; any transaction signer |

The backend key cannot check anyone in, pay anyone, register a trainer, change a schedule or reclaim. The backend stores only ciphertext of a trainer's keypair, encrypted in the trainer's browser with the trainer's password. If the backend key leaked, an attacker could reserve unallocated budget by enrolling their own wallet, which blocks real participants, but could not take money because every payout also needs a registered trainer's signature.

Trainer states: `invited` (listed by the organizer), `signed_up` (account created, key blob stored), `funded` (wallet topped up with SOL), `registered` (the organizer called `add_trainer` for that wallet, signed in the organizer's wallet). Trainers can be added at any time, including after the programme exists. Only registered trainers can check anyone in.

## 4. End-to-end flow (changed in v2)

1. **Organizer setup.** The organizer signs up (wallet signature login), enters event name, start and end dates, and trainees (name, email, phone) by typing or CSV. The CSV has the columns `name,email,phone,day1..dayK`, where K is the smaller of the event's days and 7, with no role column. It carries one amount per trainee per day; amounts can differ per person and per day. A blank cell is rejected; an explicit 0 is allowed.
2. **Trainers.** In a section of event setup separate from the trainee CSV, the organizer lists any number of trainers (no cap) and can add more at any time, including after the programme exists. There is one shared trainer link per event. A trainer opens it and signs up with a username, a phone number (must match the organizer's list) and a password. The trainer's browser creates the keypair and encrypts it with the password; only ciphertext is stored. The backend tops up each trainer wallet with a little SOL. The organizer then registers the trainer on chain by calling `add_trainer` for that wallet, signed in the organizer's wallet.
3. **Cost screen.** The app calculates and shows separately: total stipends, estimated transaction fees, wallet setup cost (rent), trainer SOL top-ups, plus one combined estimate in a uniform currency, computed from configured rates and labelled as an estimate.
4. **Funding.** The organizer creates the programme (no trainer is named) and funds the vault with the full stipend total (option 1: fund everything upfront). The programme stores the day length, number of days and participant cap.
5. **Claim link.** Once the programme is created and funded, the organizer gets one trainee link to share (for example in a WhatsApp group). A participant opens it, enters a phone number (rejected if not on the list), sets a 6-digit PIN, and the browser creates a wallet. The backend then calls `enroll` for that wallet with that participant's per-day amounts. The claim moves through the states unclaimed, pending and enrolled; a failed enroll can be retried safely; each participant row takes only one wallet; per-IP and per-phone attempt limits apply. Trainee enrollment never waits for trainers. The app may warn "no registered trainer yet" but must not block.
6. **Event day check-in.** The participant opens the link, enters the phone number and sees a QR (public wallet address). A registered trainer scans it; the trainer's phone, unlocked with the trainer's password, signs its half of that participant's check-in transaction and shows a second QR. The participant scans it, enters the PIN to sign, and submits. The program verifies both signatures, marks the day, and pays that day's amount immediately. The trainer pays the transaction fee by default.
7. **Longer events.** The CSV template covers 7 days. If the event is longer, the 7-day pattern repeats until the event's days (at most 31) are filled. The organizer can confirm or update amounts at each 7-day boundary; if amounts rise, the app calculates the shortfall and asks for a top-up.
8. **End.** After the event ends, the organizer reclaims everything left in the vault.

## 4a. Handshake detail (changed in v2)

A Solana transaction can be up to 1,232 bytes, too large for a reliable QR. The second QR therefore carries only a short link ID. The trainer's phone posts its half-signed transaction to the backend relay, which returns the ID. The participant's phone fetches it, signs and submits. A recent blockhash lasts about 150 slots, roughly 60 to 90 seconds, so the second QR expires on its own; the page shows a countdown and the trainer re-scans if it runs out. The relay only holds a transaction that pays that one participant for that one day and needs their signature to execute. Before storing a transaction the relay checks the PayDay program ID and a size limit; it holds no signing secret, because the trainer pays the fee (two signers). The relay's own expiry is 60 seconds. If the handshake proves unreliable, the fallback is both parties signing in the app; the money rules are identical.

## 5. Architecture (changed in v2)

| Layer | Responsibility | Holds |
| --- | --- | --- |
| Solana program (Rust, Anchor 1.2.2) | All money rules: funding, trainer registration, enrollment, check-in payment, schedule changes, reclaim | Programme, Vault, Enrollments, Trainers |
| Backend service | Organizer wallet-signature login, create-event, trainers and CSV-upload endpoints, claim endpoint, trainer sign-up and top-up, CSV validation, enroll calls with the backend key, fee payer, check-in relay, optional reminders, cost estimator | No stipend money |
| Database (SQLite behind one wrapper for the demo; schema kept portable to Postgres; hosting to be revisited before deploy) | People and event details | Names, emails, phones, trainer usernames, wallet addresses, encrypted keys, PIN and password hashes, pending check-ins |
| Web app | Organizer, trainer and participant views, audit page | Nothing sensitive |

Rule: the chain holds money and attendance; the database holds people and event details. No money rule ever depends on the database. The backend can lie about names but cannot move money.

## 6. Settled design decisions (changed in v2)

| Choice | Decision |
| --- | --- |
| Token program | Classic SPL Token; code written so Token-2022 could be added later |
| Attendance storage | One `u32` bitmask per Enrollment, day index 0 to 30, maximum 31 days |
| Pay | Per participant, per day: a list of `u64` amounts in the Enrollment, sized from the event's day count |
| Day number | Derived from chain time: `(now - start_ts) / day_len`; check-in also carries the day explicitly and must match |
| Clock | Solana Clock `unix_timestamp`; minimum day length 60 seconds; demo days can be about 2 minutes |
| Enrollment | At wallet creation, signed by the backend key |
| Participant token account | Created at enroll; rent paid by the fee payer |
| Check-in fee payer | The trainer pays by default (two signers, no service signing secret); the program still allows an unchecked third signer |
| Reclaim | Organizer, once, after the event ends |
| Pay changes mid-event | Organizer only, future days only, increases must be funded |
| Upgrade authority | Dev wallet during development; the README must state who holds it; consider revoking with `solana program set-upgrade-authority <PROGRAM_ID> --final` (irreversible) |
| Keys | Created in the participant's or trainer's browser, encrypted with the PIN (participants) or password (trainers), only ciphertext stored. The key is **encrypted, not hashed**; a hash cannot be used to sign later |
| PIN and trainer passwords | The PIN is 6 digits; both are verified server-side with scrypt (cost 2^17, block size 8, parallelism 1), at most 2 hashes at a time (config knob), plus per-IP and per-phone attempt limits |
| Time zone | The app converts the organizer's start date to local midnight in Kenya (UTC+3) before it reaches the program. Demo mode: config overrides for `start_ts` and `day_len` replace the conversion, and a demo start must be in the future |
| Trainers | Any number, no cap. One Trainer account per trainer wallet per programme, created by the organizer with `add_trainer` at any time; the programme has no trainer field |
| Cycle | The 7-day amount pattern repeats until `days` (at most 31) is filled |
| Claim | One shared trainee link, phone and PIN; states unclaimed, pending, enrolled; idempotent retry; refused until the vault is funded (read through the chain interface); one wallet per participant row |
| Cost rates | Configured rates only; any combined figure is labelled an estimate |
| Chain module | One interface plus a mock: `createProgramme` (no trainer), `fund`, `addTrainer(wallet)`, `enroll(trainee, amounts)` and reads. The real shape comes from the Anchor IDL; the payer stays abstract until the real-chain task |
| Storage | SQLite behind one `db.ts` wrapper; hosting revisited before deploy |

Dropped on purpose: a per-day maximum amount cap (it limited the organizer and protected little), a separate claim window, a dispute system in the core, per-participant claim codes (a nullable `claim_code_hash` column is kept in case they return).

## 7. On-chain design

### 7.1 Accounts (changed in v2)

**Programme** (PDA, seeds `["programme", organizer, programme_id]`), 168 bytes including the 8-byte discriminator (the author confirms by recount; there is no trainer field):

- `organizer`, `backend_key`, `mint` (32 bytes each)
- `programme_id`, `start_ts`, `day_len` (8 bytes each; timestamps are `i64`)
- `days` (u8), `max_participants` (u16), `enrolled` (u16)
- `total_funded`, `total_paid`, `total_reclaimed`, `committed` (u64 each)
- `bump`, `vault_bump` (u8), `reclaimed` (bool)

`committed` is money promised and not yet paid, summed over all enrollments. Key rule: **vault balance is at least committed**.

**Vault** (token account PDA, seeds `["vault", programme]`), 165 bytes. Its authority is the Programme PDA, so no person holds a key to it.

**Enrollment** (PDA, seeds `["enrollment", programme, trainee]`), 89 + 8 x days bytes including the discriminator:

- `programme`, `trainee` (32 each)
- `attendance_mask` (u32), `paid_total` (u64)
- `amounts` (list of u64, one per day, 4-byte length prefix)
- `bump`

A 5-day event is 129 bytes; a 31-day event is 337.

**Trainer** (PDA, seeds `["trainer", programme, trainer_wallet]`), about 73 bytes including the 8-byte discriminator (the author confirms by recount):

- `programme`, `trainer` (32 each)
- `bump`

No trainer count is stored, so there is no cap.

### 7.2 Instructions (changed in v2)

**1. `create_programme(programme_id, backend_key, start_ts, day_len, days, max_participants)`**

- Signer: organizer (pays rent). Accounts: organizer, programme (init), vault (init), mint, token program, system program. The mint is read from the mint account and stored; it is not an argument. There is no trainer argument.
- Checks: days 1 to 31; day\_len at least 60 seconds; start\_ts not in the past; max\_participants at least 1.
- State: sets fields, counters zero. Event: `ProgrammeCreated`.
- The backend key may equal the organizer (a no-backend fallback).

**2. `fund(amount)`**

- Signer: organizer. Accounts: organizer, programme, vault, organizer token account, mint, token program.
- Checks: signer is the organizer; amount above zero; not reclaimed; mint matches.
- State: transfer with `transfer_checked` into the vault; `total_funded` increases (checked add). Event: `Funded`. Also the top-up path.

**3. `add_trainer(trainer)`**

- Signer: organizer (pays rent). Accounts: organizer, programme, trainer account (init), system program.
- Checks: signer is the organizer; the programme is not reclaimed. A duplicate fails because the Trainer PDA already exists. It can be called at any time, including after the event has started.
- State: initialises the Trainer account. Event: `TrainerAdded`.
- `remove_trainer(trainer)` is optional and the first thing to cut.

**4. `enroll(amounts)`**

- Signer: backend key. Accounts: backend key, programme, vault (read), enrollment (init), trainee (not a signer), trainee token account (init as the trainee's associated token account), mint, token program, associated token program, system program.
- Take `amounts` as an instruction argument and size the account from `amounts.len()`; the Anchor docs show instruction arguments in `space` expressions, but cross-account fields were not found.
- Checks: signer is the backend key; not reclaimed; now before the end time; enrolled below the cap; `amounts.len()` equals `programme.days`; checked sum; **vault balance at least committed plus the new sum**. A duplicate wallet fails because the Enrollment PDA already exists. The v1 check "trainee is not the trainer" is dropped; `check_in` enforces it.
- State: writes the Enrollment; `committed` and `enrolled` increase. Event: `Enrolled`.

**5. `check_in(day)`**

- Signers: trainer and trainee. The trainer pays the fee by default; a third fee-payer signer is still allowed and unchecked. Accounts: programme, vault, enrollment, trainer account (seeds `["trainer", programme, trainer]`), trainer, trainee, trainee token account, mint, token program.
- Checks: the trainer signer has a Trainer account for this programme (the seeds bind it); trainer differs from trainee (`TrainerIsTrainee`); Enrollment seeds bind it to this trainee; now at or after start; `day` equals the derived current day and is below `days`; the mask bit is not set; the destination is the trainee's associated token account for the mint.
- State, in this order: set the bit, `paid_total` and `total_paid` increase, `committed` decreases (checked), then the PDA-signed `transfer_checked` out of the vault. A zero amount marks attendance and skips the transfer. Event: `CheckedIn`.

**6. `update_schedule(from_day, new_amounts)`** (extra, after the core cycle works)

- Signer: organizer. Accounts: organizer, programme, vault (read), enrollment.
- Checks: not reclaimed; `from_day` at least the first editable day (before start, day 0; after start, tomorrow or later; today and the past are frozen); range fits within `days`; an increase needs vault balance at least committed plus the increase, otherwise `InsufficientFunding` and the organizer funds first.
- State: replaces the range, adjusts `committed`. Event: `ScheduleUpdated` with old and new sums.

**7. `reclaim()`**

- Signer: organizer. Accounts: organizer, programme, vault, organizer token account, mint, token program.
- Checks: signer is the organizer; now at or after `end_ts = start_ts + days x day_len` (checked math); not already reclaimed.
- State: set `reclaimed`, record `total_reclaimed`, zero `committed`, transfer the whole vault balance to the organizer. Event: `Reclaimed`.
- Check-in stops at `day < days` and reclaim starts at `now >= end_ts`, so they never overlap.

### 7.3 Errors

`InvalidDays`, `InvalidDayLength`, `StartInPast`, `InvalidCapacity`, `Unauthorized`, `ProgrammeClosed`, `ProgrammeEnded`, `ProgrammeFull`, `WrongScheduleLength`, `InsufficientFunding`, `ZeroAmount`, `TrainerIsTrainee`, `NotStarted`, `WrongDay`, `AlreadyCheckedIn`, `DayNotEditable`, `EventNotOver`, `MathOverflow`.

### 7.4 Events (changed in v2)

`ProgrammeCreated`, `Funded`, `TrainerAdded`, `Enrolled`, `ScheduleUpdated`, `CheckedIn` (with amount and timestamp), `Reclaimed` (and `TrainerRemoved` if `remove_trainer` is built).

## 8. Off-chain design (changed in v2)

**Database tables:** events (linked to the programme address); trainers (username, phone, wallet address, encrypted key blob, password hash, state, failed attempts); participants (name, email, phone, wallet address, encrypted key blob, PIN hash, failed attempts, claim state, nullable `claim_code_hash`); claim links (one trainee link and one trainer link per event); pending check-ins (short ID, half-signed transaction, expiry); organizer login nonces and sessions.

**Backend duties:** organizer wallet-signature login; create-event, trainers and CSV-upload endpoints; validate the trainee CSV (`name,email,phone,day1..dayK`, no role column; reject blank cells, so a missing amount is never read as zero, plus duplicates and wrong column counts) and expand the 7-day pattern to the event's days; issue and check the trainee and trainer links; claim endpoint with the claim states, idempotent retry, refusal until the vault is funded, and per-IP and per-phone attempt limits; trainer sign-up (username, phone on the list, password) and SOL top-up; scrypt for PINs and passwords with at most 2 concurrent hashes; sign `enroll` with the backend key; fee payer; check-in relay (checks program ID and size, expiry 60 seconds); cost estimator that asks the network for the rent of each account size and uses configured rates only; all chain calls through ONE module (interface plus mock); demo-mode config for `start_ts` and `day_len`; optional reminders at 7-day boundaries.

**Front end:** organizer view (create, upload CSV, trainers section, register trainer on chain, cost breakdown, fund, status, reclaim); trainer view (sign up, scan, show second QR); participant view (claim, QR, PIN, status); audit page (totals locked, paid and returned per programme, readable without a wallet). Human names show on screen for people who are signed in; the public audit page shows aggregates and anonymous labels only.

## 9. Cost model (changed in v2)

Never hardcode rent. Devnet on 20 Nov 2026 charges 5,080 lamports per byte, with 128 bytes of overhead, measured from `solana rent 165` giving 0.00148844 SOL. Mainnet may differ. At that rate:

| Account | Bytes | Rent |
| --- | --- | --- |
| Vault (token account) | 165 | 0.00148844 SOL |
| Programme | 168 | 0.00150368 SOL |
| Trainer (each) | 73 | 0.00102108 SOL |
| Enrollment, 5-day event | 129 | 0.00130556 SOL |
| Per participant (Enrollment plus token account) |  | about 0.002794 SOL |

Transaction fees are paid in SOL by the fee-payer wallet, and check-in fees by the trainer; the stipend is a token. The cost screen shows two assets, trainer SOL top-ups as their own line (a configured amount per trainer wallet, never hardcoded), and one combined figure computed only from configured rates and labelled an estimate.

## 10. Security and trust model (changed in v2)

| Threat | Mitigation |
| --- | --- |
| Double payment | Bit set before the transfer; day must equal the current day; transactions are atomic |
| Missing or wrong signer | `Signer` types; a trainer must have a Trainer account for this programme (seeds bind it to the signer); trainee identity comes from Enrollment seeds |
| Vault authority | Vault derived from the Programme; Programme PDA is its authority; constrain address and mint |
| Wrong-recipient payment | Destination must be that trainee's associated token account for the mint |
| Arithmetic and bounds | Checked operations everywhere including the schedule sum; day bounded before any shift |
| Missing token account | Created at enroll; if a participant later closes it, check-in fails safely |
| Reclaim timing | End-time comparison and one-time flag |
| Backend key abuse | Enroll only; theft still needs a registered trainer; the organizer can reclaim at the end |
| Unregistered trainer | No Trainer account, so `check_in` fails; only the organizer can register, at any time, but not after reclaim |
| Organizer cutting pay | Future days only, with a public event trail |

**Limitations to disclose:** registered trainers are the trust point, any registered trainer can check in any trainee, and trainer-participant collusion is possible; a QR can be shown to an absent friend (a short window and a one-participant QR raise the cost, they do not remove it); immediate payment means a mistaken or dishonest confirmation cannot be undone; on-chain the program cannot tell a listed participant from a ghost wallet, because the phone-list check is off-chain; a pre-signed check-in using a durable nonce does not expire (matters only under collusion); the 6-digit PIN is weak if the database leaks, mitigated only by a slow hash; the backend can decrypt key blobs (it sees the PIN or password for server-side verification), so the system is not non-custodial and the PIN and passwords limit online guessing only; a lost phone or cleared browser loses the wallet; the backend key and fee-payer wallet are trusted for availability; the upgrade authority could change the rules; identity is only a phone number on the organizer's list; no off-ramp exists, so demo tokens cannot be cashed out; Kenyan data-protection and stablecoin rules have not been researched; the end time is shortened for the demo and the token is a test token; the shared trainee link allows slot hijacking by someone who knows a listed phone number (a denial of service; there is no unenroll); amounts are asserted by the backend at enroll, not signed by the organizer.

## 11. Verification status (changed in v2)

Checked against official documentation by an external verification pass (not by Claude directly):

- Verified: sizing a Vec account; ATA creation for a non-signing wallet with a separate payer; token-account PDA with another PDA as authority; PDA-signed token transfer with `transfer_checked` (in Anchor 1.x `CpiContext::new` takes a program ID); events and errors; Anchor 1.x tests default to Rust with LiteSVM; client package renamed to `@anchor-lang/core`; 1,232-byte transaction limit; compute limits (200,000 per instruction, 1.4 million per transaction); blockhash lifetime of 150 slots; account size limits; `--final` to revoke the upgrade authority; 5 SOL per devnet airdrop request.
- Not found, so treated as unknown: cross-account fields in `init` space (avoided by using an instruction argument); whether a signer with no on-chain account can sign read-only (test first with a never-funded participant; if it fails the backend must fund each wallet with a small amount of SOL); a numeric clock drift bound (keep the 60-second minimum day length).
- Rent: measured on devnet as above; current mainnet rate not confirmed.
- Not yet verified: whether LiteSVM lets tests set the clock for day-boundary and reclaim tests.

**Added in v2 (22 Nov 2026):**

- Programme 168 bytes and Trainer 73 bytes were recounted from the field lists by Claude (8-byte discriminator plus fields); the author confirms by recount. The rent figures in section 9 follow from those sizes at the measured 5,080 lamports per byte.
- Checked by Claude against official documentation on 22 Nov 2026: the Anchor client package rename to `@anchor-lang/core`; Hono route testing with `app.request`; OWASP's scrypt fallback parameters; Node's stability status for TypeScript, the test runner and SQLite (release candidate).
- Still unknown: whether a never-funded participant can sign check-in with the trainer as fee payer (the open on-chain test).

## 12. Test plan (changed in v2)

Local tests first (Rust, LiteSVM, in `programs/payday/tests/`), then a devnet script.

- **create\_programme:** success with no trainer argument and the mint read from the account; wrong day count, day length and capacity rejected; vault created with the Programme as authority.
- **fund:** success; non-organizer rejected; zero amount rejected; totals update.
- **add\_trainer:** success; non-organizer rejected; reclaimed programme rejected; duplicate rejected; allowed after the event has started. If built, `remove_trainer` tests come last.
- **enroll:** success; non-backend signer rejected; wrong schedule length rejected; over cap rejected; underfunded vault rejected; duplicate wallet rejected; enrolling a never-funded wallet works.
- **check\_in:** pays the right amount; second check-in same day fails; wrong day fails; before start fails; after end fails; check-in by an unregistered trainer fails; check-in by a trainer registered later succeeds; trainer equals trainee fails; the trainer alone pays the fee (two signers); payment goes only to that trainee's token account; a never-funded participant can sign.
- **reclaim:** before the end fails; after the end returns the vault balance; second reclaim fails; non-organizer fails.
- **update\_schedule** (extra): frozen days rejected; increase without funding rejected; decrease lowers committed.
- **Devnet script:** create, fund, add trainer, enroll 3, check in 2, reclaim; the absent participant's money comes back; prints short verdict lines.

## 13. Build order and cut order (changed in v2)

| Day | Goal |
| --- | --- |
| Fri 20 Nov | Programme account (size 168 by hand count), then `create_programme` and `fund` with local tests |
| Sat 21 Nov | `add_trainer`, then `enroll` and `check_in` with local tests. Evening checkpoint: if `check_in` does not pass, shrink to one trainer, one participant, 2 or 3 days |
| Sun 22 Nov | `reclaim` with tests; deploy to devnet |
| Mon 23 Nov | Devnet script: full cycle |
| 24-25 Nov | Backend (trainer sign-up, claim, enroll, relay), minimal front end; backend steps that need no chain can start earlier |
| 26 Nov | Draft demo, rehearsal |
| 27-29 Nov | Polish, QR handshake if stable, audit page, final video, submit with a buffer |

Cut order if behind: `remove_trainer`, polish, then dispute work, then QR handshake, then audit page (reduced to explorer links), then `update_schedule`, cycles and reminders. Backend cut order: reminders first, then the audit endpoints. Never cut: create and fund, enroll, check-in with payment, reclaim, README with the devnet address, demo video. If stuck on one problem for over 90 minutes, simplify.

## 14. Open items (changed in v2)

- Whether the hackathon rules treat code written before 27 Nov as pre-existing work (the README must state before versus during) and whether anything requires the build to start at the event.
- Exact UTC submission deadline from the dashboard.
- Choice of licence (MIT or Apache-2.0); security.json placeholders; after the event delete stored Git credentials and revoke the GitHub token.
- Name clash check for PayDay (a different Solana project called Stipend exists).
- Hosting for the backend and database, and SQLite for the demo versus a hosted database; free-tier limits not checked.
- Kenyan data-protection and stablecoin rules.
- Who holds the upgrade authority at submission.
- Whether one service wallet or a separate payer funds enroll rent (decide at the real-chain task).
- Node version in WSL: reported as v22.21.0 on 22 Nov 2026, which meets the 22.18 requirement; close this item once the agent confirms it.
- Whether a never-funded participant can sign check-in with the trainer as fee payer (open on-chain test).
