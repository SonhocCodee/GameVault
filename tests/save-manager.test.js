import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  initDb,
  closeDb,
  getGameById,
  getGameByTitle,
  createGame,
  addSavePath,
  getSetting,
  setSetting,
  getSaveBackups,
} from '../src/main/db.ts';
import {
  resolveVaultRoot,
  setVaultRoot,
  initSaveVault,
  detectSaveLocations,
  backupSavesNow,
  restoreSaveBackup,
  deleteSaveBackup,
  reindexVault,
} from '../src/main/save-manager.ts';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gamevault-${prefix}-`));
}

function writeSaveFile(dir, relativeName, content) {
  const fullPath = path.join(dir, relativeName);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

describe('Save Vault (backup / restore save game)', () => {
  let tmpRoots = [];

  const newTmp = (prefix) => {
    const dir = makeTempDir(prefix);
    tmpRoots.push(dir);
    return dir;
  };

  beforeEach(() => {
    initDb(':memory:');
    tmpRoots = [];
  });

  afterEach(() => {
    closeDb();
    for (const dir of tmpRoots) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('Vault root resolution & marker files', () => {
    test('setVaultRoot creates marker + pointer file and persists the setting', () => {
      const vaultRoot = newTmp('vault');
      const docsDir = newTmp('docs');

      const info = setVaultRoot(vaultRoot, { documentsDir: docsDir });

      assert.equal(info.root, path.resolve(vaultRoot));
      assert.equal(info.markerFound, true);
      assert.equal(info.isDirectory, true);
      assert.equal(info.configured, true);
      assert.equal(
        getSetting('save_vault_root'),
        path.resolve(vaultRoot),
        'vault root must be persisted in app_settings'
      );

      const markerPath = path.join(vaultRoot, 'gamevault.vault.json');
      assert.ok(fs.existsSync(markerPath), 'marker file must exist');

      const pointerPath = path.join(docsDir, 'GameVault', 'savevault.json');
      assert.ok(fs.existsSync(pointerPath), 'Documents pointer file must exist');
      const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf-8'));
      assert.equal(path.resolve(pointer.vaultRoot), path.resolve(vaultRoot));

      const resolved = resolveVaultRoot({ documentsDir: docsDir });
      assert.equal(resolved.root, path.resolve(vaultRoot));
      assert.equal(resolved.configured, true);
    });

    test('initSaveVault adopts vault from Documents pointer on fresh install (reindex)', () => {
      const vaultRoot = newTmp('vault');
      const docsDir = newTmp('docs');

      // Simulate a vault written by a previous install: marker + game slot + manifest
      fs.mkdirSync(vaultRoot, { recursive: true });
      fs.writeFileSync(
        path.join(vaultRoot, 'gamevault.vault.json'),
        JSON.stringify({ app: 'GameVault', version: 1 }),
        'utf-8'
      );
      const slotDir = path.join(vaultRoot, 'Elden Ring', '2026-01-02_120000');
      fs.mkdirSync(slotDir, { recursive: true });
      const savedFile = path.join(slotDir, '1_Elden Ring', 'save.dat');
      writeSaveFile(slotDir, '1_Elden Ring', 'old-save-content');
      fs.writeFileSync(
        path.join(slotDir, 'manifest.json'),
        JSON.stringify({
          app: 'GameVault',
          version: 1,
          gameId: 9999, // stale id — must re-resolve by title
          gameTitle: 'Elden Ring',
          exeName: 'eldenring.exe',
          slotTime: '2026-01-02_120000',
          trigger: 'manual',
          totalFiles: 1,
          totalBytes: Buffer.byteLength('old-save-content'),
          sources: [{ sourcePath: 'C:\\old\\install\\Saved', folderName: '1_Elden Ring', files: 1, bytes: 17 }],
        }),
        'utf-8'
      );
      fs.mkdirSync(path.join(docsDir, 'GameVault'), { recursive: true });
      fs.writeFileSync(
        path.join(docsDir, 'GameVault', 'savevault.json'),
        JSON.stringify({ vaultRoot }),
        'utf-8'
      );

      const info = initSaveVault({ documentsDir: docsDir });

      assert.equal(getSetting('save_vault_root'), path.resolve(vaultRoot), 'pointer root must be adopted');
      assert.equal(info.markerFound, true);

      // Old vault content is fully recognized again, including the game row
      const backups = getSaveBackups(1);
      assert.equal(backups.length, 1, 'backup row must be re-indexed');
      assert.equal(backups[0].slot_time, '2026-01-02_120000');
      const game = getGameById(1);
      assert.ok(game, 'game record must be recreated from manifest');
      assert.equal(game.title, 'Elden Ring');
      assert.ok(fs.existsSync(backups[0].backup_dir), 'indexed dir must exist on disk');
    });

    test('reindexVault refuses folders without the GameVault marker', () => {
      const notVault = newTmp('notvault');
      const summary = reindexVault(notVault);
      assert.equal(summary.backupsReindexed, 0);
      assert.equal(summary.gamesFound, 0);
    });
  });

  describe('Save location detection', () => {
    test('finds save folders in Documents/My Games, Roaming and LocalLow', () => {
      const game = createGame({ title: 'Elden Ring', exe_name: 'eldenring.exe' });

      const docs = newTmp('docs');
      const roaming = newTmp('roaming');
      const localLow = newTmp('locallow');

      writeSaveFile(path.join(docs, 'My Games', 'Elden Ring'), 'slot1.sav', 'data');
      writeSaveFile(path.join(roaming, 'EldenRing'), 'settings.cfg', 'cfg');
      writeSaveFile(path.join(localLow, 'Elden Ring'), 'unity.save', 'unity');

      const candidates = detectSaveLocations(game, {
        documentsDir: docs,
        roamingDir: roaming,
        localDir: newTmp('local'),
        localLowDir: localLow,
        savedGamesDir: newTmp('savedgames'),
        exePath: null,
      });

      const byName = new Map(candidates.map((c) => [path.basename(c.path), c]));
      assert.ok(byName.has('Elden Ring'), 'Documents/My Games match');
      assert.ok(byName.has('EldenRing'), 'Roaming match');
      const found = byName.get('Elden Ring');
      assert.equal(found.confidence, 'high');
      assert.ok(found.fileCount >= 1);
      assert.ok(found.sizeBytes > 0);
    });

    test('detects generic Saved folder next to the game install dir', () => {
      const game = createGame({ title: 'Cyberpunk 2077', exe_name: 'Cyberpunk2077.exe' });

      const installDir = newTmp('install');
      const exePath = path.join(installDir, 'bin', 'x64', 'Cyberpunk2077.exe');
      writeSaveFile(exePath, '', 'fake exe');
      writeSaveFile(path.join(installDir, 'Saved', 'SaveGames'), 'cp2077.sav', 'ue4-save');

      const candidates = detectSaveLocations(game, {
        documentsDir: newTmp('docs'),
        roamingDir: newTmp('roaming'),
        localDir: newTmp('local'),
        localLowDir: newTmp('locallow'),
        savedGamesDir: newTmp('savedgames'),
        exePath,
      });

      const savedCandidate = candidates.find((c) => c.path === path.join(installDir, 'Saved'));
      assert.ok(savedCandidate, 'install-dir Saved folder must be detected');
      assert.equal(savedCandidate.matchReason, 'install_dir');
    });

    test('returns nothing for unrelated folders', () => {
      const game = createGame({ title: 'Hades', exe_name: 'Hades.exe' });
      const docs = newTmp('docs');
      writeSaveFile(path.join(docs, 'My Games', 'Completely Different Game'), 'x.sav', 'x');

      const candidates = detectSaveLocations(game, {
        documentsDir: docs,
        roamingDir: newTmp('roaming'),
        localDir: newTmp('local'),
        localLowDir: newTmp('locallow'),
        savedGamesDir: newTmp('savedgames'),
        exePath: null,
      });
      assert.equal(candidates.length, 0);
    });
  });

  describe('Backup & restore roundtrip', () => {
    test('backup copies save folder into vault with manifest, restore brings it back', () => {
      const vaultRoot = newTmp('vault');
      const docs = newTmp('docs');
      const game = createGame({ title: 'Hollow Knight', exe_name: 'hollow_knight.exe' });

      const saveDir = path.join(docs, 'My Games', 'Hollow Knight');
      writeSaveFile(saveDir, 'user1.dat', 'progress-v1');
      writeSaveFile(saveDir, 'settings.json', '{"volume":1}');

      addSavePath(game.id, saveDir, 'My Games');
      assert.throws(() => addSavePath(game.id, saveDir), /already configured/, 'duplicate path must be rejected');

      // No paths -> clear error
      assert.throws(() => backupSavesNow(game.id + 123, undefined, { vaultRoot }), /not found/i);

      const result = backupSavesNow(game.id, undefined, { vaultRoot, documentsDir: docs });
      assert.equal(result.sources.length, 1);
      assert.equal(result.sources[0].status, 'copied');
      assert.equal(result.totalFiles, 2);
      assert.ok(result.totalBytes > 0);

      const manifestPath = path.join(result.backupDir, 'manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist in the slot');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      assert.equal(manifest.gameTitle, 'Hollow Knight');
      assert.equal(manifest.sources[0].sourcePath, path.resolve(saveDir));
      assert.ok(fs.existsSync(path.join(result.backupDir, manifest.sources[0].folderName, 'user1.dat')));

      // Human-browsable vault layout: <Vault>/Hollow Knight/<timestamp>/...
      assert.equal(path.basename(path.dirname(result.backupDir)), 'Hollow Knight');

      // Play further: modify the save after the backup
      writeSaveFile(saveDir, 'user1.dat', 'progress-v2-ruined');
      fs.rmSync(path.join(saveDir, 'settings.json'), { force: true });

      const restore = restoreSaveBackup(result.backupId, { vaultRoot, documentsDir: docs });
      assert.equal(restore.errors.length, 0);
      assert.equal(restore.restored.length, 1);
      assert.ok(restore.safetyBackupId !== null, 'pre-restore safety backup must be created');
      assert.equal(fs.readFileSync(path.join(saveDir, 'user1.dat'), 'utf-8'), 'progress-v1');
      assert.equal(fs.readFileSync(path.join(saveDir, 'settings.json'), 'utf-8'), '{"volume":1}');

      // The safety snapshot is recorded as its own backup
      const safetyRow = getSaveBackups(game.id).find((b) => b.id === restore.safetyBackupId);
      assert.ok(safetyRow, 'safety backup row exists');
      assert.equal(safetyRow.trigger, 'pre_restore');
    });

    test('restore after the game folder was deleted skips the safety net', () => {
      const vaultRoot = newTmp('vault');
      const docs = newTmp('docs');
      const game = createGame({ title: 'Reinstall Target' });
      const saveDir = path.join(docs, 'ReinstallTarget', 'Saves');
      writeSaveFile(saveDir, 'slot0.sav', 'gold-v1');
      addSavePath(game.id, saveDir);

      const result = backupSavesNow(game.id, undefined, { vaultRoot, documentsDir: docs });

      // "Delete the game" — everything gone
      fs.rmSync(saveDir, { recursive: true, force: true });

      const restore = restoreSaveBackup(result.backupId, { vaultRoot, documentsDir: docs });
      assert.equal(restore.errors.length, 0);
      assert.equal(restore.safetyBackupId, null, 'nothing current to protect');
      assert.equal(fs.readFileSync(path.join(saveDir, 'slot0.sav'), 'utf-8'), 'gold-v1');
    });

    test('restore works after a full app+db wipe via reindex (cài lại app)', () => {
      const vaultRoot = newTmp('vault');
      const docs = newTmp('docs');
      const game = createGame({ title: 'Stardew Valley', exe_name: 'Stardew Valley.exe' });

      const saveDir = path.join(docs, 'StardewValley', 'Saves');
      writeSaveFile(saveDir, 'Farm_1234/SaveGameInfo', 'xml-state-1');
      addSavePath(game.id, saveDir);
      const result = backupSavesNow(game.id, 'trước khi cài lại win', { vaultRoot, documentsDir: docs });

      fs.rmSync(saveDir, { recursive: true, force: true });

      // Fresh database (as after reinstalling the app)
      closeDb();
      initDb(':memory:');

      const summary = reindexVault(vaultRoot);
      assert.equal(summary.backupsReindexed, 1);
      assert.ok(summary.gamesFound >= 1, 'game recreated');

      const revivedGame = getGameByTitle('Stardew Valley');
      assert.ok(revivedGame, 'game must be recreated from manifest title');
      const backups = getSaveBackups(revivedGame.id);
      assert.ok(backups.length >= 1);
      assert.equal(backups[0].note, 'trước khi cài lại win');

      const restore = restoreSaveBackup(backups[0].id, { vaultRoot, documentsDir: docs });
      assert.equal(restore.errors.length, 0);
      assert.equal(
        fs.readFileSync(path.join(saveDir, 'Farm_1234', 'SaveGameInfo'), 'utf-8'),
        'xml-state-1'
      );
    });

    test('missing/empty save folders are skipped and never produce empty slots', () => {
      const vaultRoot = newTmp('vault');
      const docs = newTmp('docs');
      const game = createGame({ title: 'Missing Folder Game' });

      addSavePath(game.id, path.join(docs, 'Nope', 'Missing'));
      assert.throws(
        () => backupSavesNow(game.id, undefined, { vaultRoot }),
        /Không có dữ liệu save nào/,
        'all-skipped backup must fail loudly'
      );
      assert.equal(getSaveBackups(game.id).length, 0, 'no row for a failed backup');
    });

    test('deleteSaveBackup removes both the folder and the row', () => {
      const vaultRoot = newTmp('vault');
      const docs = newTmp('docs');
      const game = createGame({ title: 'Delete Me Game' });
      const saveDir = path.join(docs, 'DeleteMe', 'Saves');
      writeSaveFile(saveDir, 'a.sav', 'a');
      addSavePath(game.id, saveDir);

      const result = backupSavesNow(game.id, undefined, { vaultRoot, documentsDir: docs });
      assert.ok(fs.existsSync(result.backupDir));

      assert.equal(deleteSaveBackup(result.backupId), true);
      assert.equal(fs.existsSync(result.backupDir), false, 'vault folder removed');
      assert.equal(getSaveBackups(game.id).length, 0, 'row removed');
      assert.throws(() => deleteSaveBackup(result.backupId), /not found/i);
    });

    test('two backups in the same second get unique slot folders', () => {
      const vaultRoot = newTmp('vault');
      const docs = newTmp('docs');
      const game = createGame({ title: 'Rapid Game' });
      const saveDir = path.join(docs, 'RapidGame', 'Saves');
      writeSaveFile(saveDir, 'a.sav', '1');
      addSavePath(game.id, saveDir);

      const first = backupSavesNow(game.id, undefined, { vaultRoot, documentsDir: docs });
      writeSaveFile(saveDir, 'a.sav', '2');
      const second = backupSavesNow(game.id, undefined, { vaultRoot, documentsDir: docs });

      assert.notEqual(first.backupDir, second.backupDir);
      assert.equal(getSaveBackups(game.id).length, 2);
    });
  });

  describe('Settings storage', () => {
    test('get/set/delete setting roundtrip', () => {
      assert.equal(getSetting('nonexistent'), null);
      setSetting('some_key', 'value-1');
      assert.equal(getSetting('some_key'), 'value-1');
      setSetting('some_key', 'value-2');
      assert.equal(getSetting('some_key'), 'value-2');
    });
  });
});
