import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import BN from 'bn.js';
import { BorshAccountsCoder } from '@anchor-lang/core';
import { RealChain } from '../src/chain/real.js';
import { ChainError } from '../src/chain/interface.js';
import idl from '../src/chain/payday.idl.json' with { type: 'json' };

test('RealChain offline tests with fake Connection', async () => {
  const feePayer = Keypair.generate();
  const feePayerSecret = bs58.encode(feePayer.secretKey);
  const progId = Keypair.generate().publicKey;
  const progAddr = Keypair.generate().publicKey;

  // 1. Fake connection
  let sentTx: any = null;
  const fakeConnection: any = {
    async getMinimumBalanceForRentExemption(bytes: number) {
      return bytes * 1000;
    },
    async getLatestBlockhash() {
      return { blockhash: bs58.encode(Buffer.alloc(32, 1)) };
    },
    async getFeeForMessage(message: any) {
      return { value: 5000 };
    },
    async sendTransaction(tx: any, signers: any) {
      sentTx = tx;
      return bs58.encode(Buffer.alloc(64, 2));
    },
    async sendRawTransaction(raw: Buffer) {
      sentTx = raw;
      return bs58.encode(Buffer.alloc(64, 2));
    },
    async confirmTransaction() {
      return { value: { err: null } };
    },
    async getSignatureStatus() {
      return { value: { confirmationStatus: 'confirmed', confirmations: 1, err: null } };
    },
    async getAccountInfo(pubkey: PublicKey) {
      return null; // Missing account case
    },
    async getTokenAccountBalance(pubkey: PublicKey) {
      return {
        value: {
          amount: '1234567890',
          decimals: 6,
          uiAmount: 1234.56789,
          uiAmountString: '1234.56789',
        },
      };
    },
  };

  const chain = new RealChain({
    connection: fakeConnection,
    feePayerSecretKey: feePayerSecret,
    programId: progId.toBase58(),
    programmeAddress: progAddr.toBase58(),
  });

  // Test getRentExempt
  const rent = await chain.getRentExempt(165);
  assert.equal(rent, 165_000n);

  // Test getFeePerSignature
  const fee = await chain.getFeePerSignature();
  assert.equal(fee, 5000n);

  // Test topUp
  const recipient = Keypair.generate().publicKey.toBase58();
  await chain.topUp(recipient, 20_000_000n);
  assert.ok(sentTx !== null);

  // Test getVaultBalance
  const vaultBalance = await chain.getVaultBalance();
  assert.equal(vaultBalance, 1234567890n);

  // Test getProgramme when account does not exist -> null
  const missingProgramme = await chain.getProgramme();
  assert.equal(missingProgramme, null);

  // Test getProgramme with decoded mock account
  const coder = new BorshAccountsCoder(idl as any);
  const organizerKey = Keypair.generate().publicKey;
  const backendKey = Keypair.generate().publicKey;
  const mintKey = Keypair.generate().publicKey;
  const mockAccount = {
    organizer: organizerKey,
    backend_key: backendKey,
    mint: mintKey,
    programme_id: new BN(101),
    start_ts: new BN(1700000000),
    day_len: new BN(86400),
    days: 5,
    max_participants: 50,
    enrolled: 10,
    total_funded: new BN(5000000),
    total_paid: new BN(1000000),
    total_reclaimed: new BN(0),
    committed: new BN(4000000),
    bump: 254,
    vault_bump: 253,
    reclaimed: false,
  };
  const encodedData = await coder.encode('Programme', mockAccount);

  fakeConnection.getAccountInfo = async (pubkey: PublicKey) => {
    return {
      data: encodedData,
      executable: false,
      lamports: 1000000,
      owner: progId,
    };
  };

  const decodedProgramme = await chain.getProgramme();
  assert.ok(decodedProgramme !== null);
  assert.equal(decodedProgramme.organizer, organizerKey.toBase58());
  assert.equal(decodedProgramme.backendKey, backendKey.toBase58());
  assert.equal(decodedProgramme.mint, mintKey.toBase58());
  assert.equal(decodedProgramme.programmeId, '101');
  assert.equal(decodedProgramme.startTs, 1700000000n);
  assert.equal(decodedProgramme.dayLen, 86400n);
  assert.equal(decodedProgramme.days, 5);
  assert.equal(decodedProgramme.maxParticipants, 50);
  assert.equal(decodedProgramme.enrolled, 10);
  assert.equal(decodedProgramme.totalFunded, 5000000n);
  assert.equal(decodedProgramme.reclaimed, false);

  // --- Tests for isEnrolled ---
  const traineeKey = Keypair.generate().publicKey;
  const otherTraineeKey = Keypair.generate().publicKey;
  const mockEnrollment = {
    programme: progAddr,
    trainee: traineeKey,
    attendance_mask: 0,
    paid_total: new BN(0),
    amounts: [new BN(100), new BN(200)],
    bump: 255,
  };
  const encodedEnrollment = await coder.encode('Enrollment', mockEnrollment);

  // 1. Missing account -> false
  fakeConnection.getAccountInfo = async () => null;
  assert.equal(await chain.isEnrolled(traineeKey.toBase58()), false);

  // 2. Wrong owner -> false
  fakeConnection.getAccountInfo = async () => ({
    data: encodedEnrollment,
    executable: false,
    lamports: 1000000,
    owner: Keypair.generate().publicKey,
  });
  assert.equal(await chain.isEnrolled(traineeKey.toBase58()), false);

  // 3. Wrong discriminator -> false
  const badDiscEnrollment = Buffer.from(encodedEnrollment);
  badDiscEnrollment[0] ^= 0xff;
  fakeConnection.getAccountInfo = async () => ({
    data: badDiscEnrollment,
    executable: false,
    lamports: 1000000,
    owner: progId,
  });
  assert.equal(await chain.isEnrolled(traineeKey.toBase58()), false);

  // 4. Correct account -> true
  fakeConnection.getAccountInfo = async () => ({
    data: encodedEnrollment,
    executable: false,
    lamports: 1000000,
    owner: progId,
  });
  assert.equal(await chain.isEnrolled(traineeKey.toBase58()), true);

  // 5. Wrong wallet inside account -> false
  assert.equal(await chain.isEnrolled(otherTraineeKey.toBase58()), false);

  // 6. Invalid wallet string -> false
  assert.equal(await chain.isEnrolled('invalid-wallet-string'), false);

  // --- Tests for isTrainerRegistered ---
  const trainerKey = Keypair.generate().publicKey;
  const otherTrainerKey = Keypair.generate().publicKey;
  const mockTrainer = {
    programme: progAddr,
    trainer: trainerKey,
    bump: 254,
  };
  const encodedTrainer = await coder.encode('Trainer', mockTrainer);

  // 1. Missing account -> false
  fakeConnection.getAccountInfo = async () => null;
  assert.equal(await chain.isTrainerRegistered(trainerKey.toBase58()), false);

  // 2. Wrong owner -> false
  fakeConnection.getAccountInfo = async () => ({
    data: encodedTrainer,
    executable: false,
    lamports: 1000000,
    owner: Keypair.generate().publicKey,
  });
  assert.equal(await chain.isTrainerRegistered(trainerKey.toBase58()), false);

  // 3. Wrong discriminator -> false
  const badDiscTrainer = Buffer.from(encodedTrainer);
  badDiscTrainer[0] ^= 0xff;
  fakeConnection.getAccountInfo = async () => ({
    data: badDiscTrainer,
    executable: false,
    lamports: 1000000,
    owner: progId,
  });
  assert.equal(await chain.isTrainerRegistered(trainerKey.toBase58()), false);

  // 4. Correct account -> true
  fakeConnection.getAccountInfo = async () => ({
    data: encodedTrainer,
    executable: false,
    lamports: 1000000,
    owner: progId,
  });
  assert.equal(await chain.isTrainerRegistered(trainerKey.toBase58()), true);

  // 5. Wrong wallet inside account -> false
  assert.equal(await chain.isTrainerRegistered(otherTrainerKey.toBase58()), false);

  // 6. Invalid wallet string -> false
  assert.equal(await chain.isTrainerRegistered('not-a-valid-wallet'), false);
});

test('RealChain DEVNET=1 freshly generated wallet check', { skip: process.env.DEVNET !== '1' }, async () => {
  const feePayer = Keypair.generate();
  const progAddr = Keypair.generate().publicKey;
  const chain = new RealChain({
    rpcUrl: 'https://api.devnet.solana.com',
    feePayerSecretKey: bs58.encode(feePayer.secretKey),
    programmeAddress: progAddr.toBase58(),
  });

  const freshWallet = Keypair.generate().publicKey.toBase58();
  const enrolled = await chain.isEnrolled(freshWallet);
  assert.equal(enrolled, false);

  const registered = await chain.isTrainerRegistered(freshWallet);
  assert.equal(registered, false);
});

test('RealChain DEVNET=1 smoke test', { skip: process.env.DEVNET !== '1' }, async () => {
  const feePayer = Keypair.generate();
  const chain = new RealChain({
    rpcUrl: 'https://api.devnet.solana.com',
    feePayerSecretKey: bs58.encode(feePayer.secretKey),
    programId: Keypair.generate().publicKey.toBase58(),
    programmeAddress: Keypair.generate().publicKey.toBase58(),
  });

  const rent = await chain.getRentExempt(165);
  assert.ok(typeof rent === 'bigint' && rent > 0n);
  console.log(`DEVNET getRentExempt(165): ${rent.toString()} lamports`);
});

test('RealChain buildEnrollTransaction account order, flags, feePayer and amounts', async () => {
  const feePayer = Keypair.generate();
  const backend = Keypair.generate();
  const progId = Keypair.generate().publicKey;
  const progAddr = Keypair.generate().publicKey;
  const trainee = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;

  const chain = new RealChain({
    feePayerSecretKey: bs58.encode(feePayer.secretKey),
    backendKeySecretKey: bs58.encode(backend.secretKey),
    programId: progId.toBase58(),
    programmeAddress: progAddr.toBase58(),
  });

  const amounts = [100n, 250000n, 18446744073709551615n];
  const tx = chain.buildEnrollTransaction(trainee, amounts, mint);

  assert.equal(tx.feePayer?.toBase58(), backend.publicKey.toBase58());
  assert.equal(tx.instructions.length, 1);

  const ix = tx.instructions[0];
  assert.equal(ix.programId.toBase58(), progId.toBase58());

  // Derive expected PDAs
  const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  const [enrollmentPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('enrollment'), trainee.toBuffer(), progAddr.toBuffer()],
    progId,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), progAddr.toBuffer()],
    progId,
  );
  const [expectedAta] = PublicKey.findProgramAddressSync(
    [trainee.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  );

  const expectedKeys = [
    { pubkey: backend.publicKey.toBase58(), isSigner: true, isWritable: true },
    { pubkey: progAddr.toBase58(), isSigner: false, isWritable: true },
    { pubkey: trainee.toBase58(), isSigner: false, isWritable: false },
    { pubkey: enrollmentPda.toBase58(), isSigner: false, isWritable: true },
    { pubkey: expectedAta.toBase58(), isSigner: false, isWritable: true },
    { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
    { pubkey: vaultPda.toBase58(), isSigner: false, isWritable: false },
    { pubkey: ATA_PROGRAM.toBase58(), isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM.toBase58(), isSigner: false, isWritable: false },
    { pubkey: '11111111111111111111111111111111', isSigner: false, isWritable: false },
  ];

  assert.equal(ix.keys.length, expectedKeys.length);
  for (let i = 0; i < expectedKeys.length; i++) {
    assert.equal(ix.keys[i].pubkey.toBase58(), expectedKeys[i].pubkey, `Key ${i} pubkey mismatch`);
    assert.equal(ix.keys[i].isSigner, expectedKeys[i].isSigner, `Key ${i} isSigner mismatch`);
    assert.equal(ix.keys[i].isWritable, expectedKeys[i].isWritable, `Key ${i} isWritable mismatch`);
  }

  // The only signer in keys is backend
  const signers = ix.keys.filter((k) => k.isSigner);
  assert.equal(signers.length, 1);
  assert.equal(signers[0].pubkey.toBase58(), backend.publicKey.toBase58());

  // Decode instruction data
  const data = ix.data;
  const enrollDef = (idl as any).instructions.find((i: any) => i.name === 'enroll');
  const expectedDisc = Buffer.from(enrollDef.discriminator);
  assert.deepEqual(data.subarray(0, 8), expectedDisc);

  const decodedLen = data.readUInt32LE(8);
  assert.equal(decodedLen, amounts.length);

  const decodedAmounts: bigint[] = [];
  for (let i = 0; i < decodedLen; i++) {
    decodedAmounts.push(data.readBigUInt64LE(12 + i * 8));
  }
  assert.deepEqual(decodedAmounts, amounts);
});

test('RealChain buildEnrollTransaction ATA equals independently derived ATA', async () => {
  const feePayer = Keypair.generate();
  const backend = Keypair.generate();
  const progId = Keypair.generate().publicKey;
  const progAddr = Keypair.generate().publicKey;
  const trainee = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;

  const chain = new RealChain({
    feePayerSecretKey: bs58.encode(feePayer.secretKey),
    backendKeySecretKey: bs58.encode(backend.secretKey),
    programId: progId.toBase58(),
    programmeAddress: progAddr.toBase58(),
  });

  const tx = chain.buildEnrollTransaction(trainee, [50n], mint);
  const ix = tx.instructions[0];

  const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  const [independentAta] = PublicKey.findProgramAddressSync(
    [trainee.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  );

  assert.equal(ix.keys[4].pubkey.toBase58(), independentAta.toBase58());
});

test('RealChain buildEnrollTransaction throws BackendKeyMissing when backendKeypair missing', async () => {
  const feePayer = Keypair.generate();
  const progId = Keypair.generate().publicKey;
  const progAddr = Keypair.generate().publicKey;
  const trainee = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;

  const chain = new RealChain({
    feePayerSecretKey: bs58.encode(feePayer.secretKey),
    programId: progId.toBase58(),
    programmeAddress: progAddr.toBase58(),
  });

  assert.throws(
    () => chain.buildEnrollTransaction(trainee, [100n], mint),
    (err: any) => err instanceof ChainError && err.code === 'BackendKeyMissing',
  );
});

test('RealChain buildEnrollTransaction throws BadAmount when amounts is empty', async () => {
  const feePayer = Keypair.generate();
  const backend = Keypair.generate();
  const progId = Keypair.generate().publicKey;
  const progAddr = Keypair.generate().publicKey;
  const trainee = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;

  const chain = new RealChain({
    feePayerSecretKey: bs58.encode(feePayer.secretKey),
    backendKeySecretKey: bs58.encode(backend.secretKey),
    programId: progId.toBase58(),
    programmeAddress: progAddr.toBase58(),
  });

  assert.throws(
    () => chain.buildEnrollTransaction(trainee, [], mint),
    (err: any) => err instanceof ChainError && err.code === 'BadAmount',
  );
});

test('RealChain buildEnrollTransaction throws BadAmount when an amount is negative', async () => {
  const feePayer = Keypair.generate();
  const backend = Keypair.generate();
  const progId = Keypair.generate().publicKey;
  const progAddr = Keypair.generate().publicKey;
  const trainee = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;

  const chain = new RealChain({
    feePayerSecretKey: bs58.encode(feePayer.secretKey),
    backendKeySecretKey: bs58.encode(backend.secretKey),
    programId: progId.toBase58(),
    programmeAddress: progAddr.toBase58(),
  });

  assert.throws(
    () => chain.buildEnrollTransaction(trainee, [-1n], mint),
    (err: any) => err instanceof ChainError && err.code === 'BadAmount',
  );
});

test('RealChain buildEnrollTransaction throws BadAmount when an amount is above u64 max', async () => {
  const feePayer = Keypair.generate();
  const backend = Keypair.generate();
  const progId = Keypair.generate().publicKey;
  const progAddr = Keypair.generate().publicKey;
  const trainee = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;

  const chain = new RealChain({
    feePayerSecretKey: bs58.encode(feePayer.secretKey),
    backendKeySecretKey: bs58.encode(backend.secretKey),
    programId: progId.toBase58(),
    programmeAddress: progAddr.toBase58(),
  });

  assert.throws(
    () => chain.buildEnrollTransaction(trainee, [18446744073709551616n], mint),
    (err: any) => err instanceof ChainError && err.code === 'BadAmount',
  );
});

// Helper to create a fake chain environment for enroll tests
async function setupEnrollTestEnv() {
  const feePayer = Keypair.generate();
  const backend = Keypair.generate();
  const progId = Keypair.generate().publicKey;
  const progAddr = Keypair.generate().publicKey;
  const organizerKey = Keypair.generate().publicKey;
  const mintKey = Keypair.generate().publicKey;

  const coder = new BorshAccountsCoder(idl as any);
  const mockProgramme = {
    organizer: organizerKey,
    backend_key: backend.publicKey,
    mint: mintKey,
    programme_id: new BN(1),
    start_ts: new BN(1700000000),
    day_len: new BN(86400),
    days: 5,
    max_participants: 50,
    enrolled: 0,
    total_funded: new BN(1000000),
    total_paid: new BN(0),
    total_reclaimed: new BN(0),
    committed: new BN(0),
    bump: 254,
    vault_bump: 253,
    reclaimed: false,
  };
  const encodedProgramme = await coder.encode('Programme', mockProgramme);

  let rawTxSent: Buffer | null = null;
  let sendRawTxCalls = 0;

  const fakeConnection: any = {
    async getMinimumBalanceForRentExemption(bytes: number) {
      return bytes * 1000;
    },
    async getLatestBlockhash() {
      return {
        blockhash: bs58.encode(Buffer.alloc(32, 1)),
        lastValidBlockHeight: 12345,
      };
    },
    async getFeeForMessage() {
      return { value: 5000 };
    },
    async getBalance(pubkey: PublicKey) {
      return 10_000_000; // default 10M lamports, ample for rent + fee
    },
    async sendRawTransaction(raw: Buffer, opts?: any) {
      rawTxSent = raw;
      sendRawTxCalls++;
      return bs58.encode(Buffer.alloc(64, 3));
    },
    async confirmTransaction() {
      return { value: { err: null } };
    },
    async getAccountInfo(pubkey: PublicKey) {
      if (pubkey.equals(progAddr)) {
        return {
          data: encodedProgramme,
          executable: false,
          lamports: 1000000,
          owner: progId,
        };
      }
      return null;
    },
  };

  const chain = new RealChain({
    connection: fakeConnection,
    feePayerSecretKey: bs58.encode(feePayer.secretKey),
    backendKeySecretKey: bs58.encode(backend.secretKey),
    programId: progId.toBase58(),
    programmeAddress: progAddr.toBase58(),
  });

  return {
    feePayer,
    backend,
    progId,
    progAddr,
    mintKey,
    fakeConnection,
    chain,
    coder,
    getRawTxSent: () => rawTxSent,
    getSendRawTxCalls: () => sendRawTxCalls,
  };
}

test('RealChain enroll success path with valid signature and sendRawTransaction call', async () => {
  const env = await setupEnrollTestEnv();
  const trainee = Keypair.generate().publicKey.toBase58();

  await env.chain.enroll(trainee, [100n, 200n]);

  assert.equal(env.getSendRawTxCalls(), 1);
  const raw = env.getRawTxSent();
  assert.ok(raw !== null);

  const tx = Transaction.from(raw!);
  assert.equal(tx.signatures.length, 1);
  assert.equal(tx.signatures[0].publicKey.toBase58(), env.backend.publicKey.toBase58());
  assert.ok(tx.signatures[0].signature !== null);
});

test('RealChain enroll throws BadWallet on invalid trainee string', async () => {
  const env = await setupEnrollTestEnv();

  await assert.rejects(
    async () => env.chain.enroll('not-a-valid-wallet-address', [100n]),
    (err: any) => err instanceof ChainError && err.code === 'BadWallet',
  );
  assert.equal(env.getSendRawTxCalls(), 0);
});

test('RealChain enroll throws ProgrammeMissing when programme account is null', async () => {
  const env = await setupEnrollTestEnv();
  env.fakeConnection.getAccountInfo = async () => null;
  const trainee = Keypair.generate().publicKey.toBase58();

  await assert.rejects(
    async () => env.chain.enroll(trainee, [100n]),
    (err: any) => err instanceof ChainError && err.code === 'ProgrammeMissing',
  );
  assert.equal(env.getSendRawTxCalls(), 0);
});

test('RealChain enroll throws BackendKeyMissing when backend keypair is missing', async () => {
  const env = await setupEnrollTestEnv();
  const chainWithoutBackend = new RealChain({
    connection: env.fakeConnection,
    feePayerSecretKey: bs58.encode(env.feePayer.secretKey),
    programId: env.progId.toBase58(),
    programmeAddress: env.progAddr.toBase58(),
  });
  const trainee = Keypair.generate().publicKey.toBase58();

  await assert.rejects(
    async () => chainWithoutBackend.enroll(trainee, [100n]),
    (err: any) => err instanceof ChainError && err.code === 'BackendKeyMissing',
  );
  assert.equal(env.getSendRawTxCalls(), 0);
});

test('RealChain enroll throws InvalidBackend on backend key mismatch before sending', async () => {
  const env = await setupEnrollTestEnv();
  const otherBackend = Keypair.generate();
  const chainWithWrongBackend = new RealChain({
    connection: env.fakeConnection,
    feePayerSecretKey: bs58.encode(env.feePayer.secretKey),
    backendKeySecretKey: bs58.encode(otherBackend.secretKey),
    programId: env.progId.toBase58(),
    programmeAddress: env.progAddr.toBase58(),
  });
  const trainee = Keypair.generate().publicKey.toBase58();

  await assert.rejects(
    async () => chainWithWrongBackend.enroll(trainee, [100n]),
    (err: any) => err instanceof ChainError && err.code === 'InvalidBackend',
  );
  assert.equal(env.getSendRawTxCalls(), 0);
});

test('RealChain enroll throws BackendUnderfunded when balance is below needed amount', async () => {
  const env = await setupEnrollTestEnv();
  env.fakeConnection.getBalance = async () => 1000; // Way below rent + fee
  const trainee = Keypair.generate().publicKey.toBase58();

  await assert.rejects(
    async () => env.chain.enroll(trainee, [100n]),
    (err: any) => err instanceof ChainError && err.code === 'BackendUnderfunded',
  );
  assert.equal(env.getSendRawTxCalls(), 0);
});

test('RealChain enroll maps custom errors 0x177b, 0x1778, 0x1775 from thrown error message', async () => {
  const trainee = Keypair.generate().publicKey.toBase58();

  // 0x177b = 6011 = InsufficientFunding
  {
    const env = await setupEnrollTestEnv();
    env.fakeConnection.sendRawTransaction = async () => {
      throw new Error('Simulation failed: custom program error: 0x177b');
    };
    await assert.rejects(
      async () => env.chain.enroll(trainee, [100n]),
      (err: any) => err instanceof ChainError && err.code === 'InsufficientFunding',
    );
  }

  // 0x1778 = 6008 = ProgrammeFull
  {
    const env = await setupEnrollTestEnv();
    env.fakeConnection.sendRawTransaction = async () => {
      throw new Error('Transaction simulation failed: custom program error: 0x1778');
    };
    await assert.rejects(
      async () => env.chain.enroll(trainee, [100n]),
      (err: any) => err instanceof ChainError && err.code === 'ProgrammeFull',
    );
  }

  // 0x1775 = 6005 = InvalidBackend
  {
    const env = await setupEnrollTestEnv();
    env.fakeConnection.sendRawTransaction = async () => {
      throw new Error('Transaction failed: custom program error: 0x1775');
    };
    await assert.rejects(
      async () => env.chain.enroll(trainee, [100n]),
      (err: any) => err instanceof ChainError && err.code === 'InvalidBackend',
    );
  }
});

test('RealChain enroll maps confirmation InstructionError Custom result', async () => {
  const env = await setupEnrollTestEnv();
  env.fakeConnection.confirmTransaction = async () => {
    return {
      value: {
        err: {
          InstructionError: [0, { Custom: 6011 }],
        },
      },
    };
  };
  const trainee = Keypair.generate().publicKey.toBase58();

  await assert.rejects(
    async () => env.chain.enroll(trainee, [100n]),
    (err: any) => err instanceof ChainError && err.code === 'InsufficientFunding',
  );
});

test('RealChain enroll maps unknown error to RpcError', async () => {
  const env = await setupEnrollTestEnv();
  env.fakeConnection.sendRawTransaction = async () => {
    throw new Error('Connection refused / 503 Service Unavailable');
  };
  const trainee = Keypair.generate().publicKey.toBase58();

  await assert.rejects(
    async () => env.chain.enroll(trainee, [100n]),
    (err: any) => err instanceof ChainError && err.code === 'RpcError',
  );
});

test('RealChain enroll recovers if send throws but isEnrolled returns true', async () => {
  const env = await setupEnrollTestEnv();
  env.fakeConnection.sendRawTransaction = async () => {
    throw new Error('Transaction timed out');
  };

  const traineeKey = Keypair.generate().publicKey;
  const mockEnrollment = {
    programme: env.progAddr,
    trainee: traineeKey,
    attendance_mask: 0,
    paid_total: new BN(0),
    amounts: [new BN(100)],
    bump: 255,
  };
  const encodedEnrollment = await env.coder.encode('Enrollment', mockEnrollment);

  const originalGetAccountInfo = env.fakeConnection.getAccountInfo;
  env.fakeConnection.getAccountInfo = async (pubkey: PublicKey) => {
    if (pubkey.equals(env.progAddr)) {
      return originalGetAccountInfo(pubkey);
    }
    // Enrollment PDA check returns valid account
    return {
      data: encodedEnrollment,
      executable: false,
      lamports: 1000000,
      owner: env.progId,
    };
  };

  // Should resolve successfully due to retry-safety
  await env.chain.enroll(traineeKey.toBase58(), [100n]);
});

test('RealChain enroll throws mapped error if send throws and isEnrolled returns false', async () => {
  const env = await setupEnrollTestEnv();
  env.fakeConnection.sendRawTransaction = async () => {
    throw new Error('Transaction timed out waiting for commitment');
  };
  const trainee = Keypair.generate().publicKey.toBase58();

  await assert.rejects(
    async () => env.chain.enroll(trainee, [100n]),
    (err: any) => err instanceof ChainError && err.code === 'RpcError',
  );
});
