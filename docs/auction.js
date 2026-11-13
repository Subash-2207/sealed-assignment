import { providers, scenarios, solve } from './proof.js';

const $ = id => document.getElementById(id);
const jobLabel = index => `Job 0${index + 1}`;

function textNode(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function renderChainRun(report) {
  const { account, network, transactions } = report;
  if (report.format !== 'sealed-assignment-chain-run-v1' || !['sandbox', 'testnet'].includes(network)
      || !report.changedPayoutRejected || !report.replayRejected || !report.allCreditsWithdrawn
      || !transactions?.rejected || !transactions.settlement || transactions.withdrawals?.length !== 4) {
    throw new Error('The settlement report is incomplete.');
  }
  const testnet = network === 'testnet';
  $('chain-network').textContent = testnet ? 'NEAR TESTNET' : 'NEAR SANDBOX';
  $('chain-status').textContent = `Recorded ${testnet ? 'testnet' : 'local sandbox'} run using a separate market and proof. This browser demo does not send transactions.`;
  const stats = [
    ['Escrow funded', `${report.escrowMilliNear} milliNEAR`],
    ['Buyer refund', `${report.buyerRefundMilliNear} milliNEAR`],
    ['Successful withdrawals', String(transactions.withdrawals.length)],
    ['Market account', account],
  ];
  $('chain-stats').replaceChildren(...stats.map(([label, value]) => {
    const item = document.createElement('div');
    item.append(textNode('dt', label), textNode('dd', value));
    return item;
  }));
  const txs = [
    ['Changed payout rejected', transactions.rejected],
    ['Original award settled', transactions.settlement],
  ];
  $('chain-transactions').replaceChildren(...txs.map(([label, hash]) => {
    const item = document.createElement('li');
    const value = textNode(testnet ? 'a' : 'code', hash);
    if (testnet) {
      value.href = `https://testnet.nearblocks.io/txns/${encodeURIComponent(hash)}`;
      value.className = 'panel-link';
    }
    item.append(textNode('strong', label), value);
    return item;
  }));
  $('chain-report').hidden = false;
}

export function setupAuction({ proveSample }) {
  const quotes = scenarios.classic;
  const steps = [...document.querySelectorAll('.auction-steps li')];
  const setStep = index => {
    steps.forEach((step, position) => {
      if (position === index) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
  };
  for (const [index, row] of quotes.entries()) {
    const tr = document.createElement('tr');
    const heading = textNode('th', `Provider ${providers[index]}`);
    heading.scope = 'row';
    tr.append(heading, ...row.map(amount => textNode('td', amount)));
    $('auction-bids').append(tr);
  }
  $('auction-conflict').textContent = 'Provider A is cheapest for jobs 01 and 02. Awarding both to A breaks the one-job rule.';

  const award = $('auction-award');
  const proofStatus = $('auction-proof-status');
  $('auction-start').addEventListener('click', () => {
    const winner = solve(quotes);
    $('auction-total').textContent = `${winner.total} milliNEAR`;
    $('auction-awards').replaceChildren(...winner.order.map((provider, index) => {
      const item = document.createElement('li');
      item.append(textNode('span', jobLabel(index)), textNode('strong', `Provider ${providers[provider]}`),
        textNode('span', `${winner.payouts[index]} milliNEAR`));
      return item;
    }));
    award.hidden = false;
    $('auction-start').hidden = true;
    setStep(1);
    $('auction-prove').focus();
  });

  $('auction-prove').addEventListener('click', async () => {
    setStep(2);
    proofStatus.textContent = 'Loading proof assets…';
    try {
      const { originalPayout, changedPayout } = await proveSample(quotes, message => {
        proofStatus.textContent = message;
      });
      $('auction-change').textContent = `Job 03: ${originalPayout} → ${changedPayout} milliNEAR`;
      $('auction-verdicts').hidden = false;
      $('auction-chain-action').hidden = false;
      proofStatus.textContent = 'Both browser checks completed.';
      if (!$('auction').hidden) $('auction-chain').focus();
    } catch (error) {
      proofStatus.textContent = error.message || 'Proof generation failed. Please retry.';
    }
  });

  const chainButton = $('auction-chain');
  chainButton.addEventListener('click', async () => {
    const evidence = $('chain-evidence');
    evidence.hidden = false;
    evidence.tabIndex = -1;
    evidence.focus();
    setStep(3);
    $('chain-status').textContent = 'Loading the recorded chain run…';
    chainButton.disabled = true;
    try {
      const response = await fetch(new URL('./assets/chain-run.json', import.meta.url));
      if (!response.ok) throw new Error('No recorded chain run is bundled with this build.');
      renderChainRun(await response.json());
    } catch (error) {
      $('chain-status').textContent = error.message || 'Could not load the chain run. Please retry.';
      chainButton.disabled = false;
    }
  });
}
