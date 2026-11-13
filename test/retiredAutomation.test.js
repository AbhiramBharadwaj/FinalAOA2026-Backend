import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const script of ['sync-registration-sheets.js', 'sync-faculty-cvs-from-sheet.js']) {
  test(`${script} rejects execution without credentials or external access`, () => {
    const result = spawnSync(process.execPath, [`scripts/${script}`, '--apply'], {
      env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /has concluded.*sync is retired/);
  });
}

test('old scheduler is harmless and its installer cannot recreate the cron job', () => {
  for (const [file, status] of [['run-registration-sheet-sync.sh', 0], ['install-registration-sheet-cron.sh', 1]]) {
    const result = spawnSync('/bin/bash', [`scripts/server/${file}`], {
      env: { PATH: '/nonexistent', REGISTRATION_SHEET_SYNC_STATE_DIR: '/nonexistent' },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, status, result.stderr);
    assert.match(result.stdout + result.stderr, /has concluded/);
  }
});
