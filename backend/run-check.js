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

// 2. Run node test runner with tap reporter
const testRun = spawnSync('node', ['--test', '--test-reporter=tap', '--import', 'tsx', 'test/**/*.test.ts'], {
  encoding: 'utf-8',
  stdio: 'pipe',
  shell: true,
});

const out = (testRun.stdout || '') + '\n' + (testRun.stderr || '');
const lines = out.split('\n');

let passCount = 0;
let firstFailingTest = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Look for fail lines: not ok <number> - <name>
  if (/^(\s*)not ok\s+\d+/.test(line)) {
    // If it's a test (or suite failure)
    if (!firstFailingTest) {
      const match = line.match(/not ok\s+\d+\s+-\s+(.+?)(?:\s+#.*)?$/);
      firstFailingTest = match ? match[1].trim() : line.trim();
    }
  }

  // Look for pass lines: ok <number> - <name>
  if (/^(\s*)ok\s+\d+/.test(line)) {
    if (/#\s*SKIP/i.test(line)) {
      continue;
    }
    // Check if the next lines specify type: 'test' (individual test rather than suite)
    // or if '# pass <N>' summary is present.
    // If the next few lines have type: 'test', it's an individual test.
    let isTest = false;
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      if (/type:\s*'test'/.test(lines[j])) {
        isTest = true;
        break;
      }
      if (/type:\s*'suite'/.test(lines[j])) {
        isTest = false;
        break;
      }
    }
    if (isTest) {
      passCount++;
    }
  }
}

// Fallback to '# pass <N>' line if present in TAP output
const passSummaryMatch = out.match(/^#\s+pass\s+(\d+)/m);
if (passSummaryMatch) {
  passCount = parseInt(passSummaryMatch[1], 10);
}

if (testRun.status !== 0 || firstFailingTest) {
  console.log(`check: FAIL - ${firstFailingTest || 'unknown test failure'}`);
  process.exit(testRun.status || 1);
}

console.log(`check: OK (${passCount} tests)`);
process.exit(0);
