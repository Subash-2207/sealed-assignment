import assert from 'node:assert/strict';
import { curves } from 'snarkjs';
import { assertStatement, prepare, prove, sampleQuotes, solve, verify } from './protocol.mjs';

try {
  const input = await prepare(sampleQuotes);
  const { proof, publicSignals } = await prove(input);
  assertStatement(input, publicSignals);
  const verified = await verify(publicSignals, proof);
  assert.equal(verified, true);
  const changedPayout = publicSignals.with(7, String(Number(publicSignals[7]) + 1));
  const changedPayoutVerified = await verify(changedPayout, proof);
  assert.equal(changedPayoutVerified, false);

  const solution = solve(sampleQuotes);
  console.log(JSON.stringify({
    market: input.market,
    commitments: input.commitments,
    awards: solution.providers.map((provider, job) => ({
      job: job + 1, provider: ['A', 'B', 'C'][provider], milliNear: solution.payouts[job],
    })),
    totalMilliNear: solution.total,
    verified,
    changedPayoutVerified,
  }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  const curve = await curves.getCurveFromName('bn128');
  await curve.terminate();
}
