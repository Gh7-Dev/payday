# PayDay

PayDay pays training and event stipends only for days a participant attended. Each check-in needs a trainer signature and a participant signature. The money sits in a vault owned by a Solana program, so no single person can withdraw it. Money for days nobody checked in goes back to the organizer after the event.

## Honest claim

PayDay does not prove physical presence. It makes every attendance claim public, two-signed and auditable, so fraud leaves a trail a funder can check against sign-in sheets or spot checks. PayDay is not non-custodial: the backend sees trainee PINs and trainer passwords (verified with scrypt) and stores encrypted key blobs. The PIN limits online guessing only.

## Layout

    program/    Solana program (Rust, Anchor)
    backend/    API server (Node, TypeScript, Hono, SQLite)
    frontend/   Web app (Vite, React)

## Devnet

Program ID: G9aiEGjhe5ya51k6mujpbzd1LkwadKMq9uPhEr97qXaM (Solana Devnet, test token only)

## Status

TODO before submission: state what was built before the event and what was built during it, the licence, and who holds the upgrade authority.
