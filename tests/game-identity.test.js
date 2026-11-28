import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalNonSteamGameKey,
  canonicalNonSteamGameKeyFromTitle,
  canonicalNonSteamGameTitle,
} from "../src/shared/game-identity.ts";

test("non-Steam titles keep stable keys across case and punctuation changes", () => {
  assert.equal(canonicalNonSteamGameKeyFromTitle("VALORANT"), "t_valorant");
  assert.equal(canonicalNonSteamGameKeyFromTitle("Valorant"), "t_valorant");
  assert.equal(canonicalNonSteamGameKeyFromTitle("A Game: Definitive Edition"), "t_agamedefinitiveedition");
});

test("League of Legends aliases converge, including the legacy Vietnamese key", () => {
  assert.equal(canonicalNonSteamGameKeyFromTitle("League of Legends"), "t_leagueoflegends");
  assert.equal(canonicalNonSteamGameKeyFromTitle("Liên Minh Huyền Thoại"), "t_leagueoflegends");
  assert.equal(canonicalNonSteamGameKey("t_linminhhuynthoi"), "t_leagueoflegends");
  assert.equal(canonicalNonSteamGameTitle("t_linminhhuynthoi", "Liên Minh Huyền Thoại"), "League of Legends");
});
