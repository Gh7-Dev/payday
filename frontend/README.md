# PayDay frontend

Pay for the days people actually show up. Vite, React 18, TypeScript, plain CSS, hash routing.

## Run locally

Backend (port 8787):

    cd backend
    npm install
    npm run dev          # node --env-file=.env, needs backend/.env

Frontend (Vite proxies /api to http://localhost:8787):

    cd frontend
    npm install
    npm run dev          # http://localhost:5173
    npm run build        # type check and production build

## Backend modes

CHAIN=mock runs without Solana. CHAIN=real talks to Devnet and needs
BACKEND_KEY_SECRET_KEY, FEE_PAYER_SECRET_KEY, PROGRAM_ID, SOLANA_RPC_URL and
PROGRAMME_ADDRESS. After the organizer creates the programme, set
PROGRAMME_ADDRESS to the address shown and restart the backend.

## Frontend env

VITE_RPC_URL overrides the Solana RPC (default https://api.devnet.solana.com).

## Routes

    #/                          landing
    #/organizer                 sign in with Phantom, event list
    #/organizer/<eventId>       event page
    #/trainer/<eventId>/<code>  trainer link
    #/join/<eventId>/<code>     trainee link

## Deploy

Netlify: build command `npm run build`, publish directory `dist`.
public/_redirects proxies /api/* to the backend URL.

## Honest limits

Devnet demo, test token only. The server sees participant PINs, so this is not
non-custodial. PayDay does not prove anyone was in the room; it makes every
claim public, two-signed and checkable.

## Built before and during the event

[TODO owner: list what existed before the hackathon and what was built during it]

## Licence

[TODO owner: add the licence]

## Program upgrade authority

[TODO owner: confirm who holds the upgrade authority on Devnet]
