import { generateProof, maxQuote, parseReceipt, permutations, providers, scenarios, solve, validQuote, verifyProof } from './proof.js';
import { setupAuction } from './auction.js';

const $ = id => document.getElementById(id);
const bids = $('bid-rows');
const bidStatus = $('bid-status');
const scenario = $('scenario');
const generate = $('generate');
const verify = $('verify-receipt');
const importButton = $('import');
const pasteReceipt = $('paste-receipt');
const pasteDialog = $('paste-dialog');
const pasteForm = $('paste-form');
const receiptJson = $('receipt-json');
const pasteStatus = $('paste-status');
const download = $('download');
const copyReceipt = $('copy-receipt');
const tamper = $('tamper');
const testJob = $('test-job');
const testAmount = $('test-amount');
testAmount.max = String(maxQuote);
const format = new Intl.NumberFormat('en');
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });
const proofTag = $('proof-tag');
const routes = [...document.querySelectorAll('[data-route]')].map(link => ({
  link,
  id: link.dataset.route,
  view: $(link.dataset.route),
  label: link.textContent.trim(),
}));
const loginRoute = { id: 'login', view: $('login'), label: 'Sign in' };
const localPreview = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const hosted = location.hostname.endsWith('.chatgpt.site');
const entryKey = 'sealed-assignment-entered';
const entryUrl = new URL(location.href);
let entered = false;
try { entered = sessionStorage.getItem(entryKey) === 'yes'; } catch {}

function markEntered(value) {
  entered = value;
  try {
    if (value) sessionStorage.setItem(entryKey, 'yes');
    else sessionStorage.removeItem(entryKey);
  } catch {}
}

// This flag controls the welcome screen. The private Sites deployment authenticates requests.
if (hosted && entryUrl.searchParams.get('entry') === 'complete') {
  markEntered(true);
  entryUrl.searchParams.delete('entry');
  history.replaceState(null, '', entryUrl);
}
$('hosted-sign-in').hidden = !hosted;
$('local-enter').hidden = !localPreview;
$('local-login-note').hidden = !localPreview;
$('static-login-note').hidden = hosted || localPreview;
if (localPreview) $('leave-workspace').textContent = 'Exit demo';
let assignment;
let receipt;
let lastProvenBids;
let bidsHidden = false;
let busy = false;

let activeRoute;

function showView(focus = false) {
  const requested = location.hash.slice(1);
  const active = entered && requested !== 'login'
    ? routes.find(route => route.id === requested) ?? routes[0]
    : loginRoute;
  if (requested && requested !== active.id) history.replaceState(null, '', `#${active.id}`);
  if (active === activeRoute) return;
  activeRoute = active;
  document.body.dataset.view = active.id;
  const atLogin = active === loginRoute;
  loginRoute.view.hidden = !atLogin;
  document.querySelector('.rail').hidden = atLogin;
  $('leave-workspace').hidden = atLogin || !(hosted || localPreview);
  for (const route of routes) {
    const selected = route === active;
    route.view.hidden = !selected;
    if (selected) route.link.setAttribute('aria-current', 'page');
    else route.link.removeAttribute('aria-current');
  }
  $('current-view').textContent = active.label;
  if (focus) {
    window.scrollTo(0, 0);
    $('workspace').focus({ preventScroll: true });
  }
}

$('local-enter').addEventListener('click', () => {
  markEntered(true);
  location.hash = 'home';
  showView(true);
});
$('leave-workspace').addEventListener('click', event => {
  markEntered(false);
  if (!localPreview) return;
  event.preventDefault();
  // Reload to discard in-memory bids, receipts, and verification history.
  history.replaceState(null, '', '#login');
  location.reload();
});
window.addEventListener('hashchange', () => showView(true));
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  try { entered = sessionStorage.getItem(entryKey) === 'yes'; } catch {}
  if (!entered) location.reload();
});
$('skip-workspace').addEventListener('click', event => {
  event.preventDefault();
  $('workspace').focus();
});
showView();

const rows = providers.map((provider, providerIndex) => {
  const row = document.createElement('tr');
  const heading = document.createElement('th');
  heading.scope = 'row';
  heading.textContent = `Provider ${provider}`;
  row.append(heading);
  const cells = providers.map((_, jobIndex) => {
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = String(maxQuote);
    input.step = '1';
    input.required = true;
    input.inputMode = 'numeric';
    input.className = 'bid-value';
    input.setAttribute('aria-label', `Provider ${provider} bid for job ${jobIndex + 1}`);
    const masked = document.createElement('span');
    masked.className = 'sealed-value';
    masked.hidden = true;
    cell.append(input, masked);
    row.append(cell);
    return { input, masked, providerIndex, jobIndex };
  });
  bids.append(row);
  return cells;
});

function readQuotes() {
  return rows.map(row => row.map(({ input }) => input.valueAsNumber));
}

function renderAssignment() {
  const valid = rows.flat().every(({ input }) => input.validity.valid);
  assignment = valid ? solve(readQuotes()) : undefined;
  $('total').textContent = assignment ? format.format(assignment.total) : '—';
  $('assignment-status').textContent = assignment ? 'Calculated from current bids' : 'Enter a whole bid for every job';
  $('assignments').replaceChildren(...(assignment?.order.map((provider, job) => {
    const line = document.createElement('div');
    line.className = 'assignment';
    const label = document.createElement('span');
    label.textContent = `Job 0${job + 1}`;
    const name = document.createElement('span');
    name.textContent = `Provider ${providers[provider]}`;
    const amount = document.createElement('b');
    amount.textContent = format.format(assignment.payouts[job]);
    line.append(label, name, amount);
    return line;
  }) ?? []));
  $('tie-note').hidden = !assignment?.tied;
  const comparisonStatus = $('comparison-status');
  const comparisonAvailable = Boolean(assignment) && !bidsHidden;
  comparisonStatus.hidden = comparisonAvailable;
  comparisonStatus.textContent = bidsHidden
    ? 'Bids are hidden. Show them in the bid matrix to compare costs.'
    : 'Enter a valid bid for every job to compare assignments.';
  $('comparison-list').hidden = !comparisonAvailable;
  $('comparison-list').replaceChildren(...(comparisonAvailable ? assignment.ranked.map(candidate => {
    const item = document.createElement('li');
    const order = document.createElement('span');
    order.textContent = candidate.order.map((provider, job) => `${providers[provider]} → ${job + 1}`).join(' · ');
    order.setAttribute('aria-label', candidate.order.map((provider, job) => `Provider ${providers[provider]} to job ${job + 1}`).join(', '));
    const total = document.createElement('strong');
    total.textContent = `${format.format(candidate.total)} milliNEAR`;
    if (candidate.index === assignment.index) {
      item.dataset.winner = 'true';
      const label = document.createElement('small');
      label.textContent = 'Winner';
      order.append(' ', label);
    }
    item.append(order, total);
    return item;
  }) : []));
  for (const { input, masked, jobIndex, providerIndex } of rows.flat()) {
    const winning = assignment?.order[jobIndex] === providerIndex;
    input.hidden = bidsHidden;
    input.classList.toggle('winner', winning);
    masked.hidden = !bidsHidden;
    masked.classList.toggle('winner', winning);
    masked.textContent = winning ? format.format(assignment.payouts[jobIndex]) : '•••';
    masked.setAttribute('aria-label', winning ? `Winning payout ${assignment.payouts[jobIndex]}` : 'Sealed bid');
  }
  updateControls();
}

function setStatus(message = '', error = false) {
  bidStatus.textContent = message;
  bidStatus.dataset.error = String(error);
}

function setResult(state, title, detail) {
  $('verify-result').dataset.state = state;
  $('result-symbol').textContent = { valid: '✓', invalid: '×' }[state] ?? '◇';
  $('result-title').textContent = title;
  $('result-detail').textContent = detail;
}

function recordCheck(label, valid) {
  const item = document.createElement('li');
  const name = document.createElement('span');
  const verdict = document.createElement('strong');
  const time = document.createElement('time');
  const now = new Date();
  name.textContent = label;
  verdict.textContent = valid ? 'Verified' : 'Rejected';
  item.dataset.verdict = valid ? 'valid' : 'invalid';
  time.dateTime = now.toISOString();
  time.textContent = timeFormat.format(now);
  item.append(name, verdict, time);
  const history = $('history-list');
  history.prepend(item);
  if (history.children.length > 10) history.lastElementChild.remove();
  renderHistory();
}

const historyFilters = $('history-filters');

function renderHistory() {
  const filter = historyFilters.querySelector(':checked').value;
  const historyList = $('history-list');
  const entries = [...historyList.children];
  for (const entry of entries) entry.hidden = filter !== 'all' && entry.dataset.verdict !== filter;
  const hasEntries = entries.length > 0;
  const hasMatches = entries.some(entry => !entry.hidden);
  historyFilters.hidden = !hasEntries;
  $('clear-history').hidden = !hasEntries;
  historyList.hidden = !hasMatches;
  const empty = $('empty-history');
  empty.textContent = hasEntries
    ? filter === 'valid' ? 'No verified checks in this session.' : 'No rejected checks in this session.'
    : 'Generate or verify a proof to see it here.';
  empty.hidden = hasMatches;
}

historyFilters.addEventListener('change', renderHistory);
$('clear-history').addEventListener('click', () => {
  $('history-list').replaceChildren();
  historyFilters.querySelector('[value="all"]').checked = true;
  renderHistory();
  $('history-verifier').focus();
});

function updateControls() {
  generate.disabled = busy || !assignment;
  $('auction-prove').disabled = busy;
  scenario.disabled = busy;
  verify.disabled = busy || !receipt || (tamper.checked && !readPayoutChange());
  download.disabled = busy || !receipt;
  copyReceipt.disabled = busy || !receipt || !navigator.clipboard;
  importButton.disabled = busy;
  pasteReceipt.disabled = busy;
  pasteForm.querySelector('[type="submit"]').disabled = busy;
  $('close-paste').disabled = busy;
  receiptJson.readOnly = busy;
  tamper.disabled = busy || !receipt;
  testJob.disabled = busy || !receipt || !tamper.checked;
  testAmount.disabled = testJob.disabled;
  for (const { input } of rows.flat()) input.readOnly = busy;
}

function setReceipt(next, source) {
  receipt = next;
  tamper.checked = false;
  $('test-payout').hidden = true;
  const sourceLabel = $('receipt-source');
  sourceLabel.hidden = !receipt;
  sourceLabel.textContent = {
    imported: 'Imported receipt',
    sample: 'Sample auction receipt',
    generated: 'Latest generated receipt',
  }[source] ?? '';
  const details = $('receipt-details');
  details.hidden = !receipt;
  $('receipt-status').hidden = true;
  $('empty-receipt').hidden = Boolean(receipt);
  const list = $('public-inputs');
  list.replaceChildren();
  if (receipt) {
    const [market, ...signals] = receipt.publicSignals;
    const winner = permutations[Number(signals[3])].map(index => providers[index]).join(' / ');
    const entries = [
      ['Market', market], ...signals.slice(0, 3).map((commitment, index) => [`Provider ${providers[index]} commitment`, commitment]),
      ['Winning order', winner], ['Payouts', `${signals.slice(4).join(' / ')} milliNEAR`],
    ];
    for (const [label, value] of entries) {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value;
      list.append(term, description);
    }
  }
  setResult('idle', source === 'imported' ? 'Imported receipt' : 'Receipt ready', 'Verify the receipt or test a changed payout.');
  updateControls();
}

function clearProof() {
  proofTag.textContent = lastProvenBids ? 'Bids changed' : 'Awaiting proof';
  proofTag.dataset.state = '';
  $('go-verifier').hidden = true;
  setStatus();
}

function loadScenario() {
  const values = scenarios[scenario.value];
  for (const { input, providerIndex, jobIndex } of rows.flat()) input.value = values[providerIndex][jobIndex];
  clearProof();
  renderAssignment();
}

scenario.addEventListener('change', loadScenario);
bids.addEventListener('input', () => {
  scenario.value = 'custom';
  clearProof();
  renderAssignment();
});
$('visibility').addEventListener('click', event => {
  bidsHidden = !bidsHidden;
  event.currentTarget.setAttribute('aria-pressed', String(bidsHidden));
  event.currentTarget.textContent = bidsHidden ? 'Show bids' : 'Hide bids';
  renderAssignment();
});

$('bid-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !assignment) return;
  const quotes = readQuotes();
  busy = true;
  updateControls();
  setStatus('Loading proof assets…');
  try {
    const next = await generateProof(quotes, setStatus);
    setStatus('Checking the generated proof…');
    if (!await verifyProof(next)) throw new Error('The generated proof did not verify.');
    setReceipt(next, 'generated');
    recordCheck('Generated proof', true);
    lastProvenBids = true;
    proofTag.textContent = 'Proof verified';
    proofTag.dataset.state = 'valid';
    $('go-verifier').hidden = false;
    setResult('valid', 'Proof verified', 'The winning assignment and all three payouts match the proof.');
    setStatus('Receipt ready in the verifier.');
  } catch (error) {
    setStatus(error.message || 'Proof generation failed. Please retry.', true);
  } finally {
    busy = false;
    updateControls();
  }
});

function originalPayout() {
  return Number(receipt.publicSignals[5 + Number(testJob.value)]);
}

function readPayoutChange() {
  const amount = testAmount.valueAsNumber;
  if (!validQuote(amount) || amount === originalPayout()) return undefined;
  return { job: Number(testJob.value), amount };
}

function updatePayoutTest(resetAmount = false) {
  $('test-payout').hidden = !tamper.checked;
  if (tamper.checked) {
    const original = originalPayout();
    if (resetAmount) testAmount.value = String(original === maxQuote ? original - 1 : original + 1);
    $('test-original').textContent = `Original payout: ${format.format(original)} milliNEAR`;
  }
  const detail = !tamper.checked ? 'Verification will use the original public inputs.'
    : readPayoutChange() ? 'Verification will use the new payout.'
      : `Enter a different whole payout between 1 and ${format.format(maxQuote)}.`;
  setResult('idle', 'Ready to verify', detail);
  updateControls();
}

tamper.addEventListener('change', () => updatePayoutTest(true));
testJob.addEventListener('change', () => updatePayoutTest(true));
testAmount.addEventListener('input', () => updatePayoutTest());

verify.addEventListener('click', async () => {
  if (busy || !receipt) return;
  const change = tamper.checked ? readPayoutChange() : undefined;
  if (tamper.checked && !change) return;
  busy = true;
  updateControls();
  setResult('idle', 'Verifying receipt…', 'Checking the public inputs against the proof.');
  try {
    const valid = await verifyProof(receipt, change);
    recordCheck(change ? `Changed payout · Job 0${change.job + 1}` : 'Original receipt', valid);
    setResult(valid ? 'valid' : 'invalid', valid ? 'Proof verified' : 'Proof rejected', valid
      ? 'The winning assignment and all three payouts match the proof.'
      : change ? `The proof does not match the new payout for Job 0${change.job + 1}. The receipt is unchanged.`
        : 'The proof does not match the claimed assignment and payouts.');
  } catch (error) {
    setResult('invalid', 'Could not verify receipt', error.message || 'The proof could not be read.');
  } finally {
    busy = false;
    updateControls();
  }
});

download.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sealed-assignment-receipt.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

copyReceipt.addEventListener('click', async () => {
  const current = receipt;
  const status = $('receipt-status');
  try {
    await navigator.clipboard.writeText(JSON.stringify(current, null, 2));
    status.textContent = 'Receipt JSON copied.';
  } catch {
    status.textContent = 'Clipboard unavailable. Download the JSON instead.';
  }
  status.hidden = current !== receipt;
});

const file = $('file');
importButton.addEventListener('click', () => file.click());

async function importReceipt(readJson, reportError) {
  if (busy) return false;
  busy = true;
  updateControls();
  try {
    const next = parseReceipt(JSON.parse(await readJson()));
    const valid = await verifyProof(next);
    recordCheck('Imported receipt', valid);
    if (!valid) throw new Error('This receipt does not match its proof.');
    setReceipt(next, 'imported');
    setResult('valid', 'Imported proof verified', 'The winning assignment and all three payouts match the proof.');
    return true;
  } catch (error) {
    reportError(error instanceof SyntaxError ? 'Enter valid receipt JSON.' : error.message);
    return false;
  } finally {
    busy = false;
    updateControls();
  }
}

file.addEventListener('change', async () => {
  const selected = file.files[0];
  file.value = '';
  if (!selected) return;
  await importReceipt(() => {
    if (selected.size > 25_000) throw new Error('The selected file exceeds the 25 KB receipt limit.');
    return selected.text();
  }, message => setResult('invalid', 'Could not import receipt', message));
});

pasteReceipt.addEventListener('click', () => {
  pasteForm.reset();
  pasteStatus.textContent = '';
  pasteDialog.showModal();
  receiptJson.focus();
});
$('close-paste').addEventListener('click', () => pasteDialog.close());
pasteDialog.addEventListener('cancel', event => {
  if (busy) event.preventDefault();
});
pasteForm.addEventListener('submit', async event => {
  event.preventDefault();
  const json = receiptJson.value;
  pasteStatus.textContent = 'Checking the receipt…';
  const imported = await importReceipt(() => json, message => {
    pasteStatus.textContent = message;
  });
  if (imported) pasteDialog.close();
});

setupAuction({
  async proveSample(quotes, onProgress) {
    if (busy) throw new Error('Wait for the current proof check to finish.');
    busy = true;
    updateControls();
    try {
      const next = await generateProof(quotes, onProgress);
      const amount = Number(next.publicSignals[7]);
      const originalValid = await verifyProof(next);
      const changedValid = await verifyProof(next, { job: 2, amount: amount + 1 });
      if (!originalValid || changedValid) throw new Error('The sample proof did not produce the expected verification results.');
      setReceipt(next, 'sample');
      recordCheck('Sample auction proof', true);
      recordCheck('Sample auction · changed payout', false);
      setResult('valid', 'Proof verified', 'The original sample receipt matches the proof.');
      return { originalPayout: amount, changedPayout: amount + 1 };
    } finally {
      busy = false;
      updateControls();
    }
  },
});

loadScenario();
