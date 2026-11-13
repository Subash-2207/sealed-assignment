import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { curves } from 'snarkjs';
import { assertStatement, prepare, prove, sampleQuotes, solve, verify } from './protocol.mjs';

after(async () => {
  // The verifier uses the shared ffjavascript curve and its worker pool.
  const curve = await curves.getCurveFromName('bn128');
  await curve.terminate();
});

test('global assignment reserves the low-cost provider for the job where it saves most', () => {
  assert.deepEqual(solve(sampleQuotes), {
    assignment: 2, providers: [1, 0, 2], payouts: [4, 3, 6], total: 13,
  });
});

test('proof binds market, commitments, winning assignment and every payout', async () => {
  const input = await prepare(sampleQuotes);
  const { proof, publicSignals } = await prove(input);
  assertStatement(input, publicSignals);
  assert.equal(await verify(publicSignals, proof), true);
  for (const [index, value] of publicSignals.entries()) {
    assert.equal(await verify(publicSignals.with(index, String(BigInt(value) + 1n)), proof), false);
  }
});

test('circuit rejects a costlier feasible assignment and altered private quotes', async () => {
  const input = await prepare(sampleQuotes);
  await assert.rejects(prove({ ...input, assignment: 0, payouts: [2, 16, 6] }), /Assert Failed/);
  const changed = input.quotes.with(0, input.quotes[0].with(2, 22));
  await assert.rejects(prove({ ...input, quotes: changed }), /Assert Failed/);
});

test('circuit enforces the published tie-break', async () => {
  const input = await prepare(Array.from({ length: 3 }, () => [1, 1, 1]));
  assert.equal(input.assignment, 0);
  const { proof, publicSignals } = await prove(input);
  assert.equal(await verify(publicSignals, proof), true);
  await assert.rejects(prove({ ...input, assignment: 1 }), /Assert Failed/);
});
