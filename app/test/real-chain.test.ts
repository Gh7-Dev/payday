import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
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

  // Test NotImplementedYet methods
  await assert.rejects(
    async () => chain.isTrainerRegistered('dummy'),
    (err: any) => err instanceof ChainError && err.code === 'NotImplementedYet',
  );
  await assert.rejects(
    async () => chain.enroll('dummy', [100n]),
    (err: any) => err instanceof ChainError && err.code === 'NotImplementedYet',
  );
  await assert.rejects(
    async () => chain.isEnrolled('dummy'),
    (err: any) => err instanceof ChainError && err.code === 'NotImplementedYet',
  );
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
