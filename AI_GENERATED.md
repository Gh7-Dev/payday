# Who wrote what in PayDay (Solana program)

Rule I follow: I do not submit code I cannot explain. AI-generated code is explained back by me before submission (status per item below).

## Written by GH7 (the AI gave concepts, hints and review comments only, no code)
- programs/payday/src/state.rs, constants.rs
- programs/payday/src/instructions/create_programme.rs, fund.rs, add_trainer.rs, enroll.rs

## AI-generated (Claude)
- tests/test_create_programme.rs, test_fund.rs, test_add_trainer.rs, test_enroll.rs: local LiteSVM tests, each test ends with a plain-language note (earlier sessions)
- 27 Nov 2026: src/instructions/check_in.rs (my own draft file was empty) and its registration lines in instructions.rs and lib.rs. Explain-back: PENDING
- 27 Nov 2026: tests/test_check_in.rs. Explain-back: PENDING
- 27 Nov 2026: src/error.rs rewritten (error names and the single ProgrammeClosed decision are mine; the message texts were written by Claude)
- 27 Nov 2026: word swap ProgrammeEnded to ProgrammeClosed in enroll.rs and tests/test_enroll.rs, applied by script at my request
