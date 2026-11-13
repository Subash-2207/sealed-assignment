import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { g1, g2 } from './protocol.mjs';

function run(file, args) {
  const result = spawnSync(file, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed: ${args.join(' ')}`);
}

const snarkjs = (...args) => run(process.execPath, ['node_modules/snarkjs/build/cli.cjs', ...args]);
const entropy = () => randomBytes(32).toString('hex');

await mkdir('build', { recursive: true });
const circomArgs = ['circuits/assignment.circom', '--r1cs', '--wasm', '--O2', '-l', 'node_modules', '-o', 'build'];
if (process.env.CIRCOM) {
  run(process.env.CIRCOM, circomArgs);
} else {
  run(process.execPath, ['node_modules/circom2/cli.js', ...circomArgs]);
}

// For disposable demos only. A production deployment needs a public ceremony.
snarkjs('powersoftau', 'new', 'bn128', '11', 'build/tau-initial.ptau');
snarkjs('powersoftau', 'contribute', 'build/tau-initial.ptau', 'build/tau-demo.ptau', `-e=${entropy()}`);
snarkjs('powersoftau', 'prepare', 'phase2', 'build/tau-demo.ptau', 'build/tau-final.ptau');
snarkjs('groth16', 'setup', 'build/assignment.r1cs', 'build/tau-final.ptau', 'build/assignment-initial.zkey');
snarkjs('zkey', 'contribute', 'build/assignment-initial.zkey', 'build/assignment.zkey', `-e=${entropy()}`);
snarkjs('zkey', 'export', 'verificationkey', 'build/assignment.zkey', 'build/verification-key.json');

const key = JSON.parse(await readFile('build/verification-key.json', 'utf8'));
if (key.nPublic !== 8) throw new Error(`Unexpected public signal count: ${key.nPublic}`);
const nearKey = Buffer.concat([
  g1(key.vk_alpha_1), g2(key.vk_beta_2), g2(key.vk_gamma_2), g2(key.vk_delta_2), ...key.IC.map(g1),
]);
await writeFile('contract/src/verification-key.bin', nearKey);
