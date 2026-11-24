// Command-line test runner: `node tests/run.js` (Node 18+). Exits with 1 if anything fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAll } from './checks.js';

const results = runAll();

// One extra check that only makes sense on the command line: the receiver must not be able
// to peek at the truth. It may not import the simulator (world.js).
const receiverSource = readFileSync(fileURLToPath(new URL('../js/core/receiver.js', import.meta.url)), 'utf8');
const peeks = /import[^;]*world\.js/.test(receiverSource);
results.push({
  group: 'The receiver',
  name: 'receiver.js does not import world.js (it only ever sees measurements)',
  pass: !peeks,
  got: peeks ? 'imports world.js' : 'no import of world.js',
  expected: 'no import of world.js',
  ms: 0,
});

let failed = 0, group = '';
for (const r of results) {
  if (r.group !== group) {
    group = r.group;
    console.log(`\n${group}`);
  }
  if (!r.pass) failed++;
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  console.log(`        got ${r.got}${r.pass ? '' : `\n        expected ${r.expected}`}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
