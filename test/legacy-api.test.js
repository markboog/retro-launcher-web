import { strict as assert } from "node:assert";
import { test } from "node:test";
import { installLegacyApi } from "../src/legacy-api.js";

function browser() {
  const state = new Map();
  const calls = [];
  globalThis.window = {
    location: new URL("https://example.test/retro-launcher-web/"),
    fetch: (input) => {
      calls.push(input);
      return Promise.resolve(new Response("native"));
    },
    localStorage: {
      getItem: (key) => state.get(key),
      setItem: (key, value) => state.set(key, value),
    },
  };
  return { state, calls };
}

test("catalog keeps file handles local and ordinary requests use native fetch", async () => {
  const { calls } = browser();
  const file = new File(["fixture"], "game.gb");
  installLegacyApi({
    initialGames: [{ id: "gb_one", title: "Game", platform: "gb", file, url: "blob:private" }],
  });
  const catalog = await (await window.fetch("/api/catalog")).json();
  assert.deepEqual(catalog, [{ id: "gb_one", title: "Game", platform: "gb" }]);
  await window.fetch("https://elsewhere.test/api/catalog");
  await window.fetch("./demo/snake.gb");
  assert.deepEqual(calls, ["https://elsewhere.test/api/catalog", "./demo/snake.gb"]);
});

test("launch and favorites update the legacy library without enabling private routes", async () => {
  const { state } = browser();
  const file = new File(["fixture"], "game.gb");
  let launched;
  const { replaceLibrary } = installLegacyApi({
    launch: (game) => { launched = game.file; return { success: true, message: "Started" }; },
  });
  replaceLibrary([{ id: "gb_one", title: "Game", platform: "gb", file }]);
  const post = { method: "POST", body: JSON.stringify({ id: "gb_one" }) };
  assert.equal((await (await window.fetch("/api/launch", post)).json()).success, true);
  assert.equal(launched, file);
  assert.deepEqual(await (await window.fetch("/api/recent")).json(), ["gb_one"]);
  assert.equal((await (await window.fetch("/api/favorite", post)).json()).favorite, true);
  assert.deepEqual(await (await window.fetch("/api/favorites")).json(), ["gb_one"]);
  assert.equal((await window.fetch("/api/launch_tool", post)).status, 404);
  assert.equal(state.size, 2);
});
