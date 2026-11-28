import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockChain } from '../src/chain/mock.js';
import { estimateCost } from '../src/cost.js';
import { kenyaMidnightUnix, loadConfig } from '../src/config.js';

describe('S4 cost & config', () => {
  it('kenyaMidnightUnix result % 86400 === 75600 and invalid date throws', () => {
    const ts = kenyaMidnightUnix('2026-11-23');
    // Ensure seconds into UTC day is 75600 (21:00 UTC)
    // Using positive modulo logic:
    const rem = ((ts % 86400) + 86400) % 86400;
    assert.equal(rem, 75600);

    // Invalid format / dates throw
    assert.throws(() => kenyaMidnightUnix('2026-02-30'), /Invalid calendar date/);
    assert.throws(() => kenyaMidnightUnix('invalid-date'), /Invalid date format/);
    assert.throws(() => kenyaMidnightUnix('2026-13-01'), /Invalid date values/);
  });

  it('loadConfig enforces future demo start and loads rates', () => {
    const now = 1000;
    assert.throws(
      () => loadConfig({ DEMO_START_TS: '999' }, now),
      /DEMO_START_TS must be in the future/
    );
    assert.throws(
      () => loadConfig({ DEMO_START_TS: '1000' }, now),
      /DEMO_START_TS must be in the future/
    );

    const cfg = loadConfig(
      {
        DEMO_START_TS: '2000',
        DEMO_DAY_LEN: '120',
        SOL_USD: '180.5',
        TOKEN_USD: '1.0',
      },
      now
    );
    assert.equal(cfg.demoStartTs, 2000n);
    assert.equal(cfg.demoDayLen, 120n);
    assert.equal(cfg.solUsd, 180.5);
    assert.equal(cfg.tokenUsd, 1.0);
  });

  it('calculates rent for programme 1,503,680; trainer 1,021,080; vault 1,488,440; 5-day enrollment 1,305,560; per participant 2,794,000 lamports', async () => {
    const chain = new MockChain(); // default rent formula: (bytes + 128) * 5080

    const cost = await estimateCost(
      {
        days: 5,
        participants: 3,
        trainers: 2,
        stipendTotal: 15000000n, // 15 USDC
        decimals: 6,
      },
      chain
    );

    // Assert exact figures required by prompt and amendments:
    assert.equal(cost.rent.programme, 1503680n);
    assert.equal(cost.rent.perTrainer, 1021080n);
    assert.equal(cost.rent.vault, 1488440n);
    assert.equal(cost.rent.enrollment, 1305560n);
    assert.equal(cost.rent.perParticipant, 2794000n); // 1305560 + 1488440 (token account)
    assert.equal(cost.stipends.display, '15');
  });

  it('changing the mock rent changes the output', async () => {
    const customChain = new MockChain({
      rentCalculator: (bytes) => BigInt(bytes) * 1000n,
    });

    const cost = await estimateCost(
      {
        days: 5,
        participants: 1,
        trainers: 1,
        stipendTotal: 1000n,
        decimals: 2,
      },
      customChain
    );

    assert.equal(cost.rent.programme, 168000n); // 168 * 1000
    assert.equal(cost.rent.vault, 165000n); // 165 * 1000
    assert.equal(cost.rent.perTrainer, 73000n); // 73 * 1000
  });

  it('combined is null without rates, and populated with label when both rates set', async () => {
    const chain = new MockChain();

    // Without rates
    const costNoRates = await estimateCost(
      {
        days: 3,
        participants: 2,
        trainers: 1,
        stipendTotal: 5000000n,
        decimals: 6,
      },
      chain
    );
    assert.equal(costNoRates.combined, null);

    // With only SOL_USD
    const costOneRate = await estimateCost(
      {
        days: 3,
        participants: 2,
        trainers: 1,
        stipendTotal: 5000000n,
        decimals: 6,
        config: {
          trainerTopupLamports: 10_000_000n,
          topupTotalCapLamports: 100_000_000n,
          solUsd: 200,
        },
      },
      chain
    );
    assert.equal(costOneRate.combined, null);

    // With both rates set
    const costBothRates = await estimateCost(
      {
        days: 3,
        participants: 2,
        trainers: 1,
        stipendTotal: 5000000n, // 5 tokens
        decimals: 6,
        config: {
          trainerTopupLamports: 10_000_000n,
          topupTotalCapLamports: 100_000_000n,
          solUsd: 200,
          tokenUsd: 1,
        },
      },
      chain
    );
    assert.ok(costBothRates.combined);
    assert.equal(costBothRates.combined.label, 'ESTIMATE using configured rates');
    assert.ok(costBothRates.combined.totalUsd > 5);
  });
});
