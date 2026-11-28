# Dependencies

| Package | Reason | Version | Documentation |
|---|---|---|---|
| `hono` | Lightweight, fast web framework for routing, HTTP handling, and built-in CORS middleware | ^4.6.14 | https://hono.dev/docs/middleware/builtin/cors |
| `@hono/node-server` | Node.js HTTP server adapter for Hono | ^1.13.8 | https://hono.dev/getting-started/nodejs |
| `@anchor-lang/core` | Decode Anchor Programme account data from chain using IDL (`BorshAccountsCoder`) | 1.2.2 | https://github.com/coral-xyz/anchor/blob/master/ts/packages/anchor/src/coder/borsh/accounts.ts |
| `@solana/web3.js` | Solana JavaScript SDK for RPC connection, transactions, PDA derivation, and transfers | ^1.95.8 | https://solana-labs.github.io/solana-web3.js/ |
| `typescript` | TypeScript compiler for static type checking | ^5.7.2 | https://www.typescriptlang.org/docs/ |
| `@types/node` | TypeScript definitions for Node.js | ^22.10.2 | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `tsx` | TypeScript execution and loader for running tests with Node's native test runner | ^4.19.2 | https://tsx.is |
| `csv-parse` | Streaming and synchronous CSV parsing with full RFC 4180 compliance | ^5.6.0 | https://csv.js.org/parse/ |
| `tweetnacl` | ed25519 sign/verify for Solana wallet signature authentication | ^1.0.3 | https://github.com/dchest/tweetnacl-js |
| `bs58` | Base58 encoding/decoding for Solana public keys | ^6.0.0 | https://github.com/cryptocoinjs/bs58 |
| `base-x` | Generic base-N encoding/decoding (transitive dep of bs58) | ^4.0.0 | https://github.com/cryptocoinjs/base-x |
| `node:crypto` (`scrypt`) | Built-in Node crypto module for scrypt password/PIN hashing. Parameter memory usage calculation `128 * N * r` requires setting `maxmem` (default 32MB) to at least 128MB+ (e.g. 256MB) for N=2^17, r=8 | Node 22 built-in | https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback |
