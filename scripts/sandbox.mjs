import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { KeyPairEd25519, Worker } from 'near-workspaces';
import { keyStores } from 'near-api-js';
import { fieldBytes, nearProof, prepare, prove, sampleQuotes, unitInYocto } from './protocol.mjs';

const mode = process.argv[2];
if (mode !== undefined && mode !== '--testnet-faucet') throw new Error('Use --testnet-faucet for public testnet, or no argument for sandbox.');
const testnet = mode === '--testnet-faucet';
const rpcAddr = 'https://rpc.testnet.near.org';

async function startTestnet() {
  const account = `sealed-lab-${randomBytes(6).toString('hex')}.testnet`;
  const key = KeyPairEd25519.fromRandom();
  const response = await fetch('https://helper.testnet.near.org/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: account, newAccountPublicKey: key.getPublicKey().toString() }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`The testnet faucet could not fund a temporary account (HTTP ${response.status}).`);
  const worker = await Worker.init({ network: 'custom', rpcAddr, rootAccountId: account, keyStore: new keyStores.InMemoryKeyStore() });
  await worker.rootAccount.setKey(key);
  const requiredBalance = 3000n * unitInYocto;
  assert.ok(await worker.rootAccount.availableBalance() >= requiredBalance, 'The testnet faucet balance is too low to deploy the contract.');
  return worker;
}

const worker = testnet ? await startTestnet() : await Worker.init({ network: 'sandbox', rm: true });
try {
  const buyer = worker.rootAccount;
  const providers = [];
  for (const name of ['alpha', 'bravo', 'charlie']) {
    providers.push(await buyer.createSubAccount(name, testnet ? { initialBalance: 300n * unitInYocto } : {}));
  }
  const contract = await buyer.devDeploy('contract/target/near/sealed_assignment.wasm', {
    method: 'open',
    args: {
      providers: providers.map(account => account.accountId),
      deadline_ms: Date.now() + 10 * 60 * 1000,
    },
    attachedDeposit: 30n * unitInYocto,
    ...(testnet ? { initialBalance: 1500n * unitInYocto } : {}),
  });
  const { market } = await contract.view('status');
  const input = await prepare(sampleQuotes, market);
  const commits = await Promise.all(providers.map((provider, index) => provider.callRaw(contract, 'commit', {
    commitment: [...fieldBytes(input.commitments[index])],
  })));
  assert.ok(commits.every(transaction => transaction.succeeded), 'All three commitments must succeed');

  const { proof } = await prove(input);
  const args = { assignment: input.assignment, payouts: input.payouts, proof: nearProof(proof) };
  const gas = 150_000_000_000_000n;
  const changedPayouts = input.payouts.map((amount, index) => index === 2 ? amount + 1 : amount);
  const rejected = await buyer.callRaw(contract, 'settle', { ...args, payouts: changedPayouts }, { gas });
  assert.ok(rejected.failed && rejected.receiptFailureMessagesContain(/Invalid proof/), 'The contract must reject the changed payout');
  assert.deepEqual((await contract.view('status')).credit, ['0', '0', '0', '0']);
  const settlement = await buyer.callRaw(contract, 'settle', args, { gas });
  assert.ok(settlement.succeeded, 'The original proof must settle');
  const awards = settlement.parseResult();
  assert.deepEqual(awards.map(award => award.provider), [providers[1], providers[0], providers[2]].map(account => account.accountId));
  assert.deepEqual(awards.map(award => award.amount), input.payouts.map(payout => String(BigInt(payout) * unitInYocto)));
  await assert.rejects(buyer.call(contract, 'settle', args, { gas }), /Already closed/);

  const settled = await contract.view('status');
  assert.deepEqual(settled.credit, [3n, 4n, 6n, 17n].map(amount => String(amount * unitInYocto)));

  const withdrawals = [];
  for (const account of [...providers, buyer]) {
    const withdrawal = await account.callRaw(contract, 'withdraw', {}, { gas: 60_000_000_000_000n });
    assert.ok(withdrawal.succeeded && withdrawal.parseResult() === true);
    withdrawals.push(withdrawal.transactionReceipt.hash);
  }
  const status = await contract.view('status');
  assert.deepEqual(status.credit, ['0', '0', '0', '0']);
  const evidence = JSON.stringify({
    format: 'sealed-assignment-chain-run-v1', network: testnet ? 'testnet' : 'sandbox', recordedAt: new Date().toISOString(),
    account: contract.accountId, market, awards, escrowMilliNear: 30, buyerRefundMilliNear: 17,
    settlementGasBurnt: settlement.gas_burnt,
    changedPayoutRejected: true, replayRejected: true, allCreditsWithdrawn: true,
    transactions: {
      commitments: commits.map(commit => commit.transactionReceipt.hash),
      rejected: rejected.transactionReceipt.hash,
      settlement: settlement.transactionReceipt.hash,
      withdrawals,
    },
  }, null, 2);
  if (process.env.SEALED_RUN_REPORT) await writeFile(process.env.SEALED_RUN_REPORT, `${evidence}\n`);
  console.log(evidence);
} finally {
  await worker.tearDown();
}
