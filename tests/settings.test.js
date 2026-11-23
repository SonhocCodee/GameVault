import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createTestDb, createTempDirectory, cleanupTempDirectory } from './test-helpers.js';
import { loadAppSettings, saveAppSettings, VK_MAP } from '../src/main/settings.ts';
import { F6CaptureManager } from '../src/main/f6-capture.ts';
import { getSetting, setSetting } from '../src/main/db.ts';

describe('Settings & Customizable Screenshot Hotkey Suite', () => {
  let db;
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_settings_test_');
    db = createTestDb(':memory:');
  });

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {}
    }
    cleanupTempDirectory(tempDir);
  });

  it('loads default settings when database has no stored settings', () => {
    const s = loadAppSettings(db);
    assert.equal(s.screenshotEnabled, true);
    assert.equal(s.screenshotHotkey, 'F6');
    assert.equal(s.screenshotHotkeyVk, 0x75);
    assert.equal(s.autoDetectGames, true);
    assert.equal(s.pollIntervalSeconds, 5);
    assert.equal(s.hddMode, true);
  });

  it('persists and retrieves updated settings including hddMode', () => {
    const updated = saveAppSettings({
      screenshotEnabled: false,
      screenshotHotkey: 'F12',
      screenshotHotkeyVk: 0x7b,
      screenshotsDir: 'D:\\TestScreenshots',
      mediaBaseDir: 'D:\\TestMedia',
      hddMode: false,
      autoDetectGames: false,
      pollIntervalSeconds: 3,
      googleApiKey: 'AIzaSyTestKey123',
      googleCseId: 'cse-id-xyz',
    }, db);

    assert.equal(updated.screenshotEnabled, false);
    assert.equal(updated.screenshotHotkey, 'F12');
    assert.equal(updated.screenshotHotkeyVk, 0x7b);
    assert.equal(updated.screenshotsDir, 'D:\\TestScreenshots');
    assert.equal(updated.mediaBaseDir, 'D:\\TestMedia');
    assert.equal(updated.hddMode, false);
    assert.equal(updated.autoDetectGames, false);
    assert.equal(updated.pollIntervalSeconds, 3);
    assert.equal(updated.googleApiKey, 'AIzaSyTestKey123');
    assert.equal(updated.googleCseId, 'cse-id-xyz');

    // Reload from SQLite to verify persistence
    const loaded = loadAppSettings(db);
    assert.equal(loaded.screenshotEnabled, false);
    assert.equal(loaded.screenshotHotkey, 'F12');
    assert.equal(loaded.screenshotHotkeyVk, 0x7b);
    assert.equal(loaded.hddMode, false);
  });

  it('F6CaptureManager dynamically updates hotkey, paths, and enabled state', () => {
    const manager = new F6CaptureManager(db, 'C:\\Temp\\Shots', 'E:\\Game');
    assert.equal(manager.isEnabled, true);
    assert.equal(manager.hotkeyName, 'F6');
    assert.equal(manager.hotkeyVk, 0x75);

    // Disable capture
    manager.setEnabled(false);
    assert.equal(manager.isEnabled, false);
    assert.equal(manager.isF6Down, false);

    // Change hotkey to PrintScreen
    manager.setHotkey('PrintScreen', 0x2c);
    assert.equal(manager.hotkeyName, 'PrintScreen');
    assert.equal(manager.hotkeyVk, 0x2c);

    // Change paths
    manager.setPaths('D:\\NewScreenshots', 'D:\\NewMedia');
    assert.equal(manager.screenshotsDir, 'D:\\NewScreenshots');
    assert.equal(manager.mediaDir, 'D:\\NewMedia');

    // Toggle HDD Mode
    assert.equal(manager.hddMode, true);
    manager.setHddMode(false);
    assert.equal(manager.hddMode, false);

    const status = manager.getStatus();
    assert.equal(status.isEnabled, false);
    assert.equal(status.hddMode, false);
    assert.equal(status.hotkey, 'PrintScreen');
    assert.equal(status.hotkeyVk, 0x2c);
    assert.equal(status.screenshotsDir, 'D:\\NewScreenshots');
    assert.equal(status.mediaDir, 'D:\\NewMedia');
  });

  it('VK_MAP maps common function keys and special keys accurately', () => {
    assert.equal(VK_MAP['F1'], 0x70);
    assert.equal(VK_MAP['F6'], 0x75);
    assert.equal(VK_MAP['F12'], 0x7b);
    assert.equal(VK_MAP['PrintScreen'], 0x2c);
    assert.equal(VK_MAP['ScrollLock'], 0x91);
    assert.equal(VK_MAP['Pause'], 0x13);
  });
});
