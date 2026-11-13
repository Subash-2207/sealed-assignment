const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const coordinateField = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export const maxQuote = 2 ** 24 - 1;
export const validQuote = value => Number.isInteger(value) && value >= 1 && value <= maxQuote;
export const providers = ['A', 'B', 'C'];
export const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
export const scenarios = {
  classic: [[2, 3, 21], [4, 16, 23], [20, 8, 6]],
  tie: [[4, 4, 9], [4, 4, 9], [9, 9, 5]],
  diagonal: [[3, 13, 12], [12, 4, 11], [15, 11, 2]],
};

export function solve(quotes) {
  if (quotes.length !== providers.length || quotes.some(row => row.length !== providers.length || !row.every(validQuote))) {
    throw new RangeError(`Enter a whole bid from 1 to ${maxQuote} for each job.`);
  }
  const assignments = permutations.map((order, index) => {
    const payouts = order.map((provider, job) => quotes[provider][job]);
    return { index, order, payouts, total: payouts.reduce((sum, amount) => sum + amount, 0) };
  });
  const ranked = assignments.sort((a, b) => a.total - b.total || a.index - b.index);
  const [winner] = ranked;
  return { ...winner, tied: ranked[1].total === winner.total, ranked };
}

async function loadJson(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error('Unable to load proof assets. Please retry.');
  return response.json();
}

let snarkPromise;
function loadSnark() {
  snarkPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./assets/snarkjs.min.js', import.meta.url);
    script.onload = () => resolve(globalThis.snarkjs);
    script.onerror = () => {
      script.remove();
      snarkPromise = undefined;
      reject(new Error('Unable to load the proof engine. Please retry.'));
    };
    document.head.append(script);
  });
  return snarkPromise;
}

let keyPromise;
function verificationKey() {
  keyPromise ??= loadJson('./assets/verification-key.json').catch(error => {
    keyPromise = undefined;
    throw error;
  });
  return keyPromise;
}

// Poseidon(6) using the same BN254 constants and round schedule as the Circom circuit.
function poseidon(values, constants, matrix) {
  let state = [0n, ...values.map(BigInt)];
  for (let round = 0; round < 71; round++) {
    state = state.map((value, column) => (value + constants[round * 7 + column]) % field);
    state = state.map((value, column) => (
      column === 0 || round < 4 || round >= 67 ? value ** 5n % field : value
    ));
    state = matrix.map(row => row.reduce((sum, coefficient, index) => sum + coefficient * state[index], 0n) % field);
  }
  return String(state[0]);
}

function random128() {
  return String(crypto.getRandomValues(new Uint32Array(4)).reduce(
    (result, word) => (result << 32n) | BigInt(word), 0n,
  ));
}

export async function generateProof(quotes, onProgress) {
  const assignment = solve(quotes);
  const [snark, parameters] = await Promise.all([loadSnark(), loadJson('./assets/poseidon6.json')]);
  const constants = parameters.constants.map(BigInt);
  const matrix = parameters.matrix.map(row => row.map(BigInt));
  const market = random128();
  const salts = providers.map(random128);
  const commitments = quotes.map((row, index) => poseidon([market, index, ...row, salts[index]], constants, matrix));
  const input = { market, commitments, assignment: assignment.index, payouts: assignment.payouts, quotes, salts };
  onProgress('Generating zero-knowledge proof…');
  const { proof, publicSignals } = await snark.groth16.fullProve(
    input, new URL('./assets/assignment.wasm', import.meta.url).href,
    new URL('./assets/assignment.zkey', import.meta.url).href, undefined, undefined, { singleThread: true },
  );
  const expected = [market, ...commitments, assignment.index, ...assignment.payouts].map(String);
  if (publicSignals.length !== expected.length || expected.some((value, index) => value !== publicSignals[index])) {
    throw new Error('The proof returned an unexpected public statement.');
  }
  return { format: 'sealed-assignment-groth16-v1', publicSignals, proof };
}

export function parseReceipt(value) {
  const { format, publicSignals, proof } = value ?? {};
  const isFieldElement = element => typeof element === 'string' && /^\d{1,77}$/.test(element) && BigInt(element) < field;
  const coordinate = element => typeof element === 'string' && /^\d{1,77}$/.test(element) && BigInt(element) < coordinateField;
  const g1 = point => Array.isArray(point) && point.length === 3 && point.every(coordinate);
  const g2 = point => Array.isArray(point) && point.length === 3 && point.every(
    row => Array.isArray(row) && row.length === 2 && row.every(coordinate),
  );
  if (format !== 'sealed-assignment-groth16-v1' || !Array.isArray(publicSignals) || publicSignals.length !== 8
    || !publicSignals.every(isFieldElement) || BigInt(publicSignals[0]) >= 2n ** 128n
    || BigInt(publicSignals[4]) >= BigInt(permutations.length) || !publicSignals.slice(5).every(payout => validQuote(Number(payout)))
    || proof?.protocol !== 'groth16' || proof.curve !== 'bn128' || !g1(proof.pi_a) || !g2(proof.pi_b) || !g1(proof.pi_c)) {
    throw new Error('Choose a valid Sealed Assignment proof receipt.');
  }
  return { format, publicSignals, proof: { protocol: proof.protocol, curve: proof.curve, pi_a: proof.pi_a, pi_b: proof.pi_b, pi_c: proof.pi_c } };
}

export async function verifyProof(receipt, change) {
  const { publicSignals, proof } = parseReceipt(receipt);
  const signals = [...publicSignals];
  if (change) {
    if (!Number.isInteger(change.job) || change.job < 0 || change.job >= providers.length || !validQuote(change.amount)) {
      throw new RangeError('Choose a job and enter a valid whole payout.');
    }
    signals[5 + change.job] = String(change.amount);
  }
  const [snark, key] = await Promise.all([loadSnark(), verificationKey()]);
  return snark.groth16.verify(key, signals, proof);
}
