import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { closeDb, createGame, deleteGame, getDb, getGames, initDb } from '../src/main/db.ts';
import { openAccountLibrary } from '../src/main/account-library.ts';
import {
  parseVdfText,
  scanAmdInstalledGames,
  scanAndImportLocalGames,
  scanEpicGames,
  scanGogGames,
  scanRiotGames,
  scanSteamGames,
  scanWindowsGameConfigStore,
  scanXboxGames,
} from '../src/main/local-game-scanner.ts';

describe('Local PC Game & Playtime Scanner', () => {
  let rootDir;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-local-scan-'));
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  test('parseVdfText parses nested Steam libraryfolders and localconfig cleanly', () => {
    const sample = `
      // comment
      "libraryfolders"
      {
        "0"
        {
          "path" "C:\\\\Program Files (x86)\\\\Steam"
        }
        "1"
        {
          "path" "D:\\\\SteamLibrary"
        }
      }
    `;
    const parsed = parseVdfText(sample);
    assert.equal(parsed.libraryfolders['0'].path, 'C:\\Program Files (x86)\\Steam');
    assert.equal(parsed.libraryfolders['1'].path, 'D:\\SteamLibrary');
  });

  test('scanSteamGames reads multi-library ACF manifests, skips redistributables, and reads localconfig Playtime', async () => {
    const steamRoot = path.join(rootDir, 'Steam');
    const secondLib = path.join(rootDir, 'SteamLib2');
    fs.mkdirSync(path.join(steamRoot, 'steamapps', 'common', 'Steamworks Shared'), { recursive: true });
    fs.mkdirSync(path.join(secondLib, 'steamapps', 'common', 'Elden Ring', 'Game'), { recursive: true });
    fs.writeFileSync(
      path.join(secondLib, 'steamapps', 'common', 'Elden Ring', 'Game', 'eldenring.exe'),
      'MZ'
    );
    fs.mkdirSync(path.join(steamRoot, 'userdata', '12345', 'config'), { recursive: true });

    fs.writeFileSync(
      path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders" { "0" { "path" "${steamRoot.replace(/\\/g, '\\\\')}" } "1" { "path" "${secondLib.replace(/\\/g, '\\\\')}" } }`
    );
    fs.writeFileSync(
      path.join(steamRoot, 'steamapps', 'appmanifest_228980.acf'),
      `"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" "installdir" "Steamworks Shared" }`
    );
    fs.writeFileSync(
      path.join(secondLib, 'steamapps', 'appmanifest_1245620.acf'),
      `"AppState" { "appid" "1245620" "name" "ELDEN RING" "installdir" "Elden Ring" }`
    );
    fs.writeFileSync(
      path.join(steamRoot, 'userdata', '12345', 'config', 'localconfig.vdf'),
      `"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" { "1245620" { "Playtime" "320" "LastPlayed" "1764000000" } } } } } }`
    );

    const games = await scanSteamGames({ steamRoot });
    assert.equal(games.length, 1);
    assert.equal(games[0].title, 'ELDEN RING');
    assert.equal(games[0].steamId, 1245620);
    assert.equal(games[0].exeName, 'eldenring.exe');
    assert.equal(games[0].playtimeMinutes, 320);
    assert.ok(games[0].lastPlayedAt && games[0].lastPlayedAt.startsWith('2025-11-'));
  });

  test('scanEpicGames reads completed .item manifests and skips incomplete / UE tools', () => {
    const manifestsDir = path.join(rootDir, 'EpicManifests');
    const gameDir = path.join(rootDir, 'AlanWake2');
    fs.mkdirSync(manifestsDir, { recursive: true });
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'AlanWake2.exe'), 'MZ');

    fs.writeFileSync(
      path.join(manifestsDir, 'aw2.item'),
      JSON.stringify({
        DisplayName: 'Alan Wake 2',
        InstallLocation: gameDir,
        LaunchExecutable: 'AlanWake2.exe',
        AppName: 'AlanWake2',
        bIsIncompleteInstall: false,
      })
    );
    fs.writeFileSync(
      path.join(manifestsDir, 'ue5.item'),
      JSON.stringify({
        DisplayName: 'Unreal Engine 5.4',
        InstallLocation: gameDir,
        LaunchExecutable: 'AlanWake2.exe',
        AppName: 'UE_5.4',
        bIsIncompleteInstall: false,
      })
    );
    fs.writeFileSync(
      path.join(manifestsDir, 'partial.item'),
      JSON.stringify({
        DisplayName: 'Incomplete Game',
        InstallLocation: gameDir,
        LaunchExecutable: 'AlanWake2.exe',
        AppName: 'Partial',
        bIsIncompleteInstall: true,
      })
    );

    const games = scanEpicGames({ epicManifestsDir: manifestsDir });
    assert.equal(games.length, 1);
    assert.equal(games[0].title, 'Alan Wake 2');
    assert.equal(games[0].exeName, 'AlanWake2.exe');
  });

  test('scanGogGames reads galaxy-2.0.db installed games and GameTimes', () => {
    const gogDbPath = path.join(rootDir, 'galaxy-2.0.db');
    const gameDir = path.join(rootDir, 'Cyberpunk2077');
    fs.mkdirSync(path.join(gameDir, 'bin', 'x64'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'bin', 'x64', 'Cyberpunk2077.exe'), 'MZ');

    const gog = new DatabaseSync(gogDbPath);
    gog.exec(`
      CREATE TABLE InstalledBaseProducts(productId INTEGER, installationPath TEXT);
      CREATE TABLE LimitedDetails(productId INTEGER, title TEXT);
      CREATE TABLE PlayTasks(id INTEGER, gameReleaseKey TEXT, isPrimary INTEGER);
      CREATE TABLE PlayTaskLaunchParameters(playTaskId INTEGER, executablePath TEXT);
      CREATE TABLE GameTimes(releaseKey TEXT, minutesInGame INTEGER);
      INSERT INTO InstalledBaseProducts VALUES (1423049311, '${gameDir.replace(/\\/g, '\\\\')}');
      INSERT INTO LimitedDetails VALUES (1423049311, 'Cyberpunk 2077');
      INSERT INTO PlayTasks VALUES (1, 'gog_1423049311', 1);
      INSERT INTO PlayTaskLaunchParameters VALUES (1, 'bin/x64/Cyberpunk2077.exe');
      INSERT INTO GameTimes VALUES ('gog_1423049311', 540);
    `);
    gog.close();

    const games = scanGogGames({ gogDbPath });
    assert.equal(games.length, 1);
    assert.equal(games[0].title, 'Cyberpunk 2077');
    assert.equal(games[0].exeName, 'Cyberpunk2077.exe');
    assert.equal(games[0].playtimeMinutes, 540);
  });

  test('scanRiotGames, scanXboxGames, and scanAmdInstalledGames detect games accurately', () => {
    const riotDir = path.join(rootDir, 'Riot Games', 'VALORANT', 'live', 'ShooterGame', 'Binaries', 'Win64');
    fs.mkdirSync(riotDir, { recursive: true });
    fs.writeFileSync(path.join(riotDir, 'VALORANT-Win64-Shipping.exe'), 'MZ');
    const riotJson = path.join(rootDir, 'RiotClientInstalls.json');
    fs.writeFileSync(
      riotJson,
      JSON.stringify({
        associated_client: {
          [path.join(rootDir, 'Riot Games', 'VALORANT', 'live')]: 'C:/Riot Games/Riot Client/RiotClientServices.exe',
          'C:/Riot Games/Riot Client/': 'C:/Riot Games/Riot Client/RiotClientServices.exe',
        },
      })
    );
    const riotGames = scanRiotGames({ riotInstallsPath: riotJson });
    assert.equal(riotGames.length, 1);
    assert.equal(riotGames[0].title, 'VALORANT');
    assert.equal(riotGames[0].exeName, 'VALORANT-Win64-Shipping.exe');

    const xboxRoot = path.join(rootDir, 'XboxGames');
    const xboxContent = path.join(xboxRoot, 'Forza Horizon 5', 'Content');
    fs.mkdirSync(xboxContent, { recursive: true });
    fs.writeFileSync(path.join(xboxContent, 'ForzaHorizon5.exe'), 'MZ');
    fs.writeFileSync(
      path.join(xboxContent, 'MicrosoftGame.Config'),
      '<Game><Identity Name="Forza"/><ShellVisuals DefaultDisplayName="ms-resource:Title"/><ExecutableList><Executable Name="ForzaHorizon5.exe"/></ExecutableList></Game>'
    );
    const xboxGames = scanXboxGames({ xboxDirs: [xboxRoot] });
    assert.equal(xboxGames.length, 1);
    assert.equal(xboxGames[0].title, 'Forza Horizon 5');
    assert.equal(xboxGames[0].exeName, 'ForzaHorizon5.exe');

    const amdDir = path.join(rootDir, 'AMD');
    fs.mkdirSync(amdDir, { recursive: true });
    const amdDbPath = path.join(amdDir, 'RGStats.db');
    const amdDb = new DatabaseSync(amdDbPath);
    amdDb.exec(`
      CREATE TABLE InstalledGames(GameID INTEGER, Title TEXT, ExePath TEXT, SteamID INTEGER, PlayTotal INTEGER);
      INSERT INTO InstalledGames VALUES
        (1, 'Hades II', 'D:\\Games\\Hades II\\Hades2.exe', 1145350, 95),
        (2, 'Ollama', 'C:\\Users\\Test\\AppData\\Local\\Programs\\Ollama\\ollama.exe', -1, 400);
    `);
    amdDb.close();
    fs.writeFileSync(
      path.join(amdDir, 'gmdb.blb'),
      JSON.stringify({ games: [{ title: 'Hades II', total_played_mins: 140 }] })
    );
    const amdGames = scanAmdInstalledGames({ amdDbPath });
    assert.equal(amdGames.length, 1);
    assert.equal(amdGames[0].title, 'Hades II');
    assert.equal(amdGames[0].playtimeMinutes, 140);
  });

  test('scanWindowsGameConfigStore filters desktop utilities and accepts verified games', async () => {
    const gameDir = path.join(rootDir, 'Games', 'Hollow Knight');
    const appDir = path.join(rootDir, 'AppData', 'Local', 'Programs', 'Editor');
    fs.mkdirSync(gameDir, { recursive: true });
    fs.mkdirSync(appDir, { recursive: true });
    const gameExe = path.join(gameDir, 'hollow_knight.exe');
    const appExe = path.join(appDir, 'code.exe');
    fs.writeFileSync(gameExe, 'MZ');
    fs.writeFileSync(path.join(gameDir, 'steam_appid.txt'), '367520');
    fs.writeFileSync(appExe, 'MZ');

    const detected = await scanWindowsGameConfigStore({
      windowsExeCandidates: [gameExe, appExe, path.join(rootDir, 'missing.exe')],
    });
    assert.equal(detected.length, 1);
    assert.equal(detected[0].steamId, 367520);
    assert.equal(detected[0].exeName, 'hollow_knight.exe');
  });

  test('scanAndImportLocalGames deduplicates, credits manual playtime only (recorded = 0), and respects deleted_games & guest isolation', async () => {
    const dbDir = path.join(rootDir, 'UserData');
    const db = openAccountLibrary('user-1', dbDir);

    const steamRoot = path.join(rootDir, 'Steam');
    fs.mkdirSync(path.join(steamRoot, 'steamapps', 'common', 'Hades II'), { recursive: true });
    fs.writeFileSync(path.join(steamRoot, 'steamapps', 'common', 'Hades II', 'Hades2.exe'), 'MZ');
    fs.mkdirSync(path.join(steamRoot, 'userdata', '1', 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(steamRoot, 'steamapps', 'appmanifest_1145350.acf'),
      `"AppState" { "appid" "1145350" "name" "Hades II" "installdir" "Hades II" }`
    );
    fs.writeFileSync(
      path.join(steamRoot, 'userdata', '1', 'config', 'localconfig.vdf'),
      `"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" { "1145350" { "Playtime" "120" } } } } } }`
    );

    const epicDir = path.join(rootDir, 'Epic');
    const alanDir = path.join(rootDir, 'AlanWake2');
    fs.mkdirSync(epicDir, { recursive: true });
    fs.mkdirSync(alanDir, { recursive: true });
    fs.writeFileSync(path.join(alanDir, 'AlanWake2.exe'), 'MZ');
    fs.writeFileSync(
      path.join(epicDir, 'aw2.item'),
      JSON.stringify({
        DisplayName: 'Alan Wake 2',
        InstallLocation: alanDir,
        LaunchExecutable: 'AlanWake2.exe',
        AppName: 'AW2',
      })
    );

    const amdDbPath = path.join(rootDir, 'RGStats.db');
    const amdDb = new DatabaseSync(amdDbPath);
    amdDb.exec(`
      CREATE TABLE InstalledGames(GameID INTEGER, Title TEXT, ExePath TEXT, SteamID INTEGER, PlayTotal INTEGER);
      INSERT INTO InstalledGames VALUES (1, 'Hades II', 'D:\\Steam\\Hades2.exe', 1145350, 185);
    `);
    amdDb.close();

    const scanOpts = {
      targetDb: db,
      steamRoot,
      epicManifestsDir: epicDir,
      gogDbPath: path.join(rootDir, 'no-gog.db'),
      riotInstallsPath: path.join(rootDir, 'no-riot.json'),
      xboxDirs: [],
      amdDbPath,
      includeWindowsGameConfigStore: false,
      enrichCovers: false,
    };

    const summary1 = await scanAndImportLocalGames(scanOpts);
    assert.equal(summary1.importedGames, 2);
    assert.equal(summary1.gamesWithPlaytime, 1);
    assert.equal(summary1.totalPlaytimeMinutes, 185);

    const games = getGames();
    assert.equal(games.length, 2);
    const hades = games.find((g) => g.title === 'Hades II');
    assert.ok(hades);
    assert.equal(hades.playtime_minutes, 185);
    assert.equal(hades.recorded_playtime_minutes, 0);
    assert.equal(hades.manual_playtime_minutes, 185);
    assert.ok(hades.last_played_at && Number(hades.last_played_at.slice(0, 4)) >= 2024);

    // Re-scan is idempotent
    const summary2 = await scanAndImportLocalGames(scanOpts);
    assert.equal(summary2.importedGames, 0);
    assert.equal(getGames().length, 2);

    // Deleting a game prevents resurrection on re-scan
    deleteGame(hades.id);
    const summary3 = await scanAndImportLocalGames(scanOpts);
    assert.equal(summary3.importedGames, 0);
    assert.equal(getGames().length, 1);

    // Guest account cannot import device history
    const guestDb = openAccountLibrary(null, dbDir);
    const guestSummary = await scanAndImportLocalGames({ ...scanOpts, targetDb: guestDb });
    assert.equal(guestSummary.importedGames, 0);
    assert.deepEqual(getGames(), []);
  });
});
