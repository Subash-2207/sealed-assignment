import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildPoseidon } from 'circomlibjs';
import { groth16 } from 'snarkjs';

export const permutations = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2],
  [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

export const sampleQuotes = [
  [2, 3, 21],
  [4, 16, 23],
  [20, 8, 6],
];

export function solve(quotes) {
  if (quotes.length !== 3 || quotes.some(row => row.length !== 3 || row.some(
    quote => !Number.isInteger(quote) || quote < 1 || quote >= 2 ** 24,
  ))) {
    throw new RangeError('Expected a 3 × 3 matrix of positive 24-bit integer quotes');
  }

  const candidates = permutations.map((providers, assignment) => {
    const payouts = providers.map((provider, job) => quotes[provider][job]);
    return { assignment, providers, payouts, total: payouts.reduce((sum, amount) => sum + amount, 0) };
  });
  return candidates.reduce((best, current) => current.total < best.total ? current : best);
}

export function randomFieldInput() {
  return BigInt(`0x${randomBytes(16).toString('hex')}`).toString();
}

export async function prepare(quotes, market = randomFieldInput()) {
  const solution = solve(quotes);
  const salts = quotes.map(() => randomFieldInput());
  const poseidon = await buildPoseidon();
  const commitments = quotes.map((row, provider) => (
    poseidon.F.toString(poseidon([market, provider, ...row, salts[provider]]))
  ));
  return { market, commitments, quotes, salts, assignment: solution.assignment, payouts: solution.payouts };
}

export async function prove(input) {
  return groth16.fullProve(
    input, 'build/assignment_js/assignment.wasm', 'build/assignment.zkey',
    undefined, undefined, { singleThread: true },
  );
}

export async function verify(publicSignals, proof) {
  const verificationKey = JSON.parse(await readFile('build/verification-key.json', 'utf8'));
  return groth16.verify(verificationKey, publicSignals, proof);
}

export const unitInYocto = 10n ** 21n;

export function fieldBytes(decimal) {
  const bytes = BigInt(decimal).toString(16).padStart(64, '0');
  if (!/^[a-f\d]{64}$/.test(bytes)) throw new RangeError('Expected an unsigned 256-bit integer');
  return Buffer.from(bytes, 'hex').reverse();
}

export function g1(point) {
  return Buffer.concat(point.slice(0, 2).map(fieldBytes));
}

export function g2(point) {
  return Buffer.concat(point.slice(0, 2).flat().map(fieldBytes));
}

export function nearProof(proof) {
  return {
    a: [...g1(proof.pi_a)],
    b: [...g2(proof.pi_b)],
    c: [...g1(proof.pi_c)],
  };
}

export function assertStatement(input, publicSignals) {
  const expected = [input.market, ...input.commitments, input.assignment, ...input.payouts].map(String);
  if (JSON.stringify(publicSignals) !== JSON.stringify(expected)) {
    throw new Error('Public signal order differs from the NEAR verifier ABI');
  }
}
