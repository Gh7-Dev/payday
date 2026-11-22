import { spawnSync } from 'node:child_process';

// 1. Run type check
const tsc = spawnSync('npx', ['tsc', '--noEmit'], {
  encoding: 'utf-8',
  stdio: 'pipe',
  shell: true,
});

if (tsc.status !== 0) {
  const errOutput = (tsc.stdout || '') + (tsc.stderr || '');
  const firstError = errOutput.trim().split('\n')[0] || 'Type check failed';
  console.log(`check: FAIL - ${firstError}`);
  process.exit(tsc.status || 1);
}

// 2. Run node test runner with tap reporter so we can reliably count passes
const testRun = spawnSync('node', ['--test', '--test-reporter=tap', '--import', 'tsx', 'test/**/*.test.ts'], {
  encoding: 'utf-8',
  stdio: 'pipe',
  shell: true,
});

const out = (testRun.stdout || '') + '\n' + (testRun.stderr || '');
const lines = out.split('\n');

let passCount = 0;
let firstFailingTest = null;

for (const line of lines) {
  // Check for pass lines, e.g., "ok 1 - health route -> 200"
  // Exclude subtest lines if any or count individual ok lines
  if (/^ok\s+\d+/.test(line)) {
    // If it's a skipped test, don't count as pass or fail
    if (/#\s*SKIP/i.test(line)) {
      continue;
    }
    passCount++;
  } else if (/^not ok\s+\d+/.test(line)) {
    if (!firstFailingTest) {
      const match = line.match(/^not ok\s+\d+\s+-\s+(.+?)(?:\s+#.*)?$/);
      firstFailingTest = match ? match[1].trim() : line.trim();
    }
  }
}

if (testRun.status !== 0 || firstFailingTest) {
  console.log(`check: FAIL - ${firstFailingTest || 'unknown test failure'}`);
  process.exit(testRun.status || 1);
}

console.log(`check: OK (${passCount} tests)`);
process.exit(0);
