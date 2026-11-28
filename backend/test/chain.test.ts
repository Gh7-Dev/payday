import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockChain } from '../src/chain/mock.js';
import { ChainError } from '../src/chain/interface.js';

describe('S5 chain mock', () => {
  function createStandardMock(): MockChain {
    const chain = new MockChain();
    chain.createProgramme({
      organizer: 'organizer_pubkey',
      backendKey: 'backend_pubkey',
      mint: 'mint_pubkey',
      programmeId: 'programme_123',
      startTs: 1000n,
      dayLen: 86400n,
      days: 3,
      maxParticipants: 2,
    });
    return chain;
  }

  it('getRentExempt follows the default formula', async () => {
    const chain = new MockChain();
    // Default formula: (bytes + 128) * 5080
    // Test for 165 bytes (vault) -> (165 + 128) * 5080 = 293 * 5080 = 1,488,440
    const rent165 = await chain.getRentExempt(165);
    assert.equal(rent165, 1488440n);

    // Test for 168 bytes (programme) -> (168 + 128) * 5080 = 296 * 5080 = 1,503,680
    const rent168 = await chain.getRentExempt(168);
    assert.equal(rent168, 1503680n);

    // Test fee per signature default: 5000
    const fee = await chain.getFeePerSignature();
    assert.equal(fee, 5000n);
  });

  it('enroll before funded or with too little vault fails', async () => {
    const chain = createStandardMock();
    const amounts = [100n, 200n, 300n]; // sum = 600n

    // Before funded
    await assert.rejects(
      async () => chain.enroll('trainee_1', amounts),
      (err: ChainError) => {
        assert.equal(err.code, 'InsufficientFunding');
        return true;
      }
    );

    // Fund with too little (e.g. 500n < 600n)
    chain.fund(500n);
    await assert.rejects(
      async () => chain.enroll('trainee_1', amounts),
      (err: ChainError) => {
        assert.equal(err.code, 'InsufficientFunding');
        return true;
      }
    );
  });

  it('funded enroll succeeds and raises committed', async () => {
    const chain = createStandardMock();
    const amounts = [100n, 200n, 300n]; // sum = 600n

    chain.fund(1000n);
    assert.equal(await chain.getVaultBalance(), 1000n);

    await chain.enroll('trainee_1', amounts);
    const prog = await chain.getProgramme();
    assert.ok(prog);
    assert.equal(prog.enrolled, 1);
    assert.equal(prog.committed, 600n);
  });

  it('duplicate trainee fails', async () => {
    const chain = createStandardMock();
    chain.fund(2000n);
    await chain.enroll('trainee_1', [100n, 100n, 100n]);

    await assert.rejects(
      async () => chain.enroll('trainee_1', [100n, 100n, 100n]),
      (err: ChainError) => {
        assert.equal(err.code, 'Unauthorized');
        return true;
      }
    );
  });

  it('over max_participants fails', async () => {
    const chain = createStandardMock(); // maxParticipants: 2
    chain.fund(3000n);
    await chain.enroll('trainee_1', [100n, 100n, 100n]);
    await chain.enroll('trainee_2', [100n, 100n, 100n]);

    await assert.rejects(
      async () => chain.enroll('trainee_3', [100n, 100n, 100n]),
      (err: ChainError) => {
        assert.equal(err.code, 'ProgrammeFull');
        return true;
      }
    );
  });

  it('amounts length not equal to days fails', async () => {
    const chain = createStandardMock(); // days: 3
    chain.fund(2000n);

    await assert.rejects(
      async () => chain.enroll('trainee_1', [100n, 100n]), // only 2 days
      (err: ChainError) => {
        assert.equal(err.code, 'WrongScheduleLength');
        return true;
      }
    );

    await assert.rejects(
      async () => chain.enroll('trainee_1', [100n, 100n, 100n, 100n]), // 4 days
      (err: ChainError) => {
        assert.equal(err.code, 'WrongScheduleLength');
        return true;
      }
    );
  });

  it('enroll after reclaim fails', async () => {
    const chain = createStandardMock();
    chain.fund(2000n);
    chain.markReclaimed();

    await assert.rejects(
      async () => chain.enroll('trainee_1', [100n, 100n, 100n]),
      (err: ChainError) => {
        assert.equal(err.code, 'ProgrammeClosed');
        return true;
      }
    );
  });

  it('isTrainerRegistered false then true after addTrainer', async () => {
    const chain = createStandardMock();
    const trainerWallet = 'trainer_wallet_xyz';

    assert.equal(await chain.isTrainerRegistered(trainerWallet), false);
    chain.addTrainer(trainerWallet);
    assert.equal(await chain.isTrainerRegistered(trainerWallet), true);
  });

  it('topUp adds lamports', async () => {
    const chain = new MockChain();
    const wallet = 'trainer_wallet_abc';

    assert.equal(chain.getWalletBalance(wallet), 0n);
    await chain.topUp(wallet, 5000000n);
    assert.equal(chain.getWalletBalance(wallet), 5000000n);
    await chain.topUp(wallet, 2000000n);
    assert.equal(chain.getWalletBalance(wallet), 7000000n);
  });
});
