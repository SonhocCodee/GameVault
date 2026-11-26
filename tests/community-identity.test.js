import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCommunityIdentity } from "../src/renderer/community/identity.ts";

const shell = {
  loggedIn: true,
  configPresent: true,
  profile: {
    uid: "player",
    displayName: "PawPaw",
    email: "private@example.test",
    photoUrl: "",
  },
};
test("a missing community endpoint preserves the signed-in navbar identity", async () => {
  const result = await loadCommunityIdentity(async () => {
    throw new Error("Route not found: GET /api/community/me");
  }, shell);
  assert.equal(result.state, "unavailable");
  assert.equal(result.profile.uid, "player");
  assert.equal(result.profile.nickname, "PawPaw");
  assert.ok(!JSON.stringify(result.profile).includes("private@example.test"));
});
test("desktop anonymous and loading shell states do not independently probe authentication", async () => {
  const request = async () => {
    throw new Error("Unexpected authentication call");
  };
  assert.equal((await loadCommunityIdentity(request, null)).state, "checking");
  assert.deepEqual(
    await loadCommunityIdentity(request, {
      loggedIn: false,
      profile: null,
      configPresent: true,
    }),
    { profile: null, state: "ready" },
  );
});
test("an expired session is a distinct desktop error rather than a second anonymous login", async () => {
  const result = await loadCommunityIdentity(async () => {
    throw new Error("Sign in to continue");
  }, shell);
  assert.equal(result.expired, true);
  assert.equal(result.profile.nickname, "PawPaw");
  assert.equal(result.state, "unavailable");
});
test("public web readers are anonymous only on an actual unauthorized response", async () => {
  assert.deepEqual(
    await loadCommunityIdentity(async () => {
      throw new Error("Sign in to continue");
    }),
    { profile: null, state: "ready" },
  );
  assert.equal(
    (
      await loadCommunityIdentity(async () => {
        throw new Error("Community is temporarily unavailable");
      })
    ).state,
    "unavailable",
  );
});
