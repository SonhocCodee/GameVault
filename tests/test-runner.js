import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALL_TEST_FILES = [
  'db.test.js',
  'importer.test.js',
  'sync.test.js',
  'tracker.test.js',
  'media.test.js',
  'e2e.test.js'
];

async function main() {
  const args = process.argv.slice(2);
  const filter = args[0] ? args[0].toLowerCase() : null;

  let selectedFiles = ALL_TEST_FILES;
  if (filter) {
    selectedFiles = ALL_TEST_FILES.filter(file => file.toLowerCase().includes(filter));
    if (selectedFiles.length === 0) {
      console.error(`\x1b[31m[ERROR] No test files matched filter: "${filter}"\x1b[0m`);
      console.log(`Available test files:\n${ALL_TEST_FILES.map(f => '  - ' + f).join('\n')}`);
      process.exit(1);
    }
  }

  const filePaths = selectedFiles.map(file => path.join(__dirname, file));

  console.log('\x1b[36m========================================================\x1b[0m');
  console.log('\x1b[35m           GAMEVAULT AUTOMATED TEST RUNNER              \x1b[0m');
  console.log('\x1b[36m========================================================\x1b[0m');
  console.log(`\x1b[33mEnvironment:\x1b[0m Node ${process.version} | Electron ${process.versions.electron || 'N/A'} | SQLite ${process.versions.sqlite || 'built-in'}`);
  console.log(`\x1b[33mSelected Suites (${selectedFiles.length}):\x1b[0m`);
  selectedFiles.forEach(f => console.log(`  • tests/${f}`));
  console.log('\x1b[36m--------------------------------------------------------\x1b[0m\n');

  let failedCount = 0;
  let passedCount = 0;

  const testStream = run({
    files: filePaths,
    concurrency: 1
  });

  testStream.on('test:pass', () => {
    passedCount++;
  });

  testStream.on('test:fail', () => {
    failedCount++;
    process.exitCode = 1;
  });

  testStream.compose(spec).pipe(process.stdout);

  testStream.on('end', () => {
    console.log('\n\x1b[36m--------------------------------------------------------\x1b[0m');
    if (failedCount === 0) {
      console.log(`\x1b[32m✔ ALL TEST SUITES PASSED! (${passedCount} assertions/subtests passed)\x1b[0m`);
    } else {
      console.log(`\x1b[31m✖ TEST RUN FAILED! (${failedCount} failed, ${passedCount} passed)\x1b[0m`);
    }
    console.log('\x1b[36m========================================================\x1b[0m');
  });
}

main().catch(err => {
  console.error('\x1b[31m[FATAL ERROR IN TEST RUNNER]\x1b[0m', err);
  process.exit(1);
});
