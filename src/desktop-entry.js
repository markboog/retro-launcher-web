import "./desktop.css";
import { describeFile, SYSTEMS } from "./library.js";
import { installLegacyApi } from "./legacy-api.js";

const demo = {
  id: "browser_snake",
  title: "Game Boy Snake",
  platform: "gb",
  system: "gb",
  genre: "Puzzle",
  year: 2018,
  desc: "A Game Boy version of Snake by Christian Reinbacher. Press Enter to start and use the arrow keys.",
  url: new URL("./demo/snake.gb", document.baseURI).href,
};
const catalog = new Map([[demo.id, demo]]);
const folderInput = document.getElementById("browser-library-folder");
const singleDialog = document.getElementById("browser-game-dialog");
const fileForm = document.getElementById("browser-game-form");
const fileInput = document.getElementById("browser-game-file");
const systemInput = document.getElementById("browser-game-system");
const fileError = document.getElementById("browser-game-error");
const browserStatus = () => document.getElementById("status-selection");
const windowId = "browser-game-player";

window.retroBrowserArtwork = (id) => id === demo.id
  ? new URL("./demo/source/images/screenshot_bw.png", document.baseURI).href
  : null;

async function browserGame(file, system) {
  const info = describeFile(file, system);
  const input = new TextEncoder().encode(info.id);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  const id = "browser_" + Array.from(bytes.slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    ...info,
    id,
    platform: info.system === "segaMD" ? "md" : info.system,
    filename: file.name,
    genre: "Classic",
    desc: "Local " + SYSTEMS[info.system] + " game.",
  };
}

let activeSession = null;

async function play(game, setupMode) {
  if (setupMode || !Object.hasOwn(SYSTEMS, game.system)) {
    return { success: false, message: "This game needs the Windows edition." };
  }

  window.closeWindow(windowId);
  const width = Math.max(260, Math.min(720, window.innerWidth - 42));
  const height = Math.max(230, Math.min(540, window.innerHeight - 140));
  const win = window.createMdiWindow(windowId, game.title, "icons/gameboy.svg", 32, 26, width, height, true);
  window.restoreWindow(windowId);
  win.client.classList.add("browser-player-client");

  const display = document.createElement("div");
  display.className = "browser-player-display";
  const controls = document.createElement("div");
  controls.className = "browser-player-controls";
  const progress = document.createElement("span");
  progress.setAttribute("role", "status");
  progress.textContent = "Starting " + game.title + "…";
  const stop = document.createElement("button");
  stop.type = "button";
  stop.className = "win31-btn";
  stop.textContent = "Stop";
  stop.addEventListener("click", () => window.closeWindow(windowId));
  controls.append(progress, stop);
  win.client.append(display, controls);

  const session = { player: null, release: null };
  activeSession = session;
  window.registerWindowCleanup(windowId, () => {
    session.player?.stop();
    session.release?.();
    if (activeSession === session) activeSession = null;
  });

  try {
    const { startGame } = await import("./emulator.js");
    if (activeSession !== session) return { success: false, message: "The player was closed." };
    const url = game.file ? URL.createObjectURL(game.file) : game.url;
    if (game.file) session.release = () => URL.revokeObjectURL(url);

    const handle = await startGame({
      container: display, system: game.system, title: game.title, url,
      onStatus: ({ state, message }) => {
        if (activeSession !== session) return;
        progress.textContent = message;
        if (state === "error") browserStatus().textContent = message;
      },
    });
    if (activeSession === session) session.player = handle;
    else handle.stop();
    return { success: true, message: "Opened " + game.title + " in the browser player" };
  } catch (error) {
    progress.textContent = error instanceof Error ? error.message : "The game player could not start.";
    return { success: false, message: progress.textContent };
  }
}

const api = installLegacyApi({
  initialGames: Array.from(catalog.values()),
  launch: play,
  openLibrary: () => Array.from(catalog.values()),
});

async function refreshLibrary() {
  api.replaceLibrary(Array.from(catalog.values()));
  await window.retroReloadCatalog();
}

folderInput.addEventListener("change", async () => {
  const files = Array.from(folderInput.files);
  folderInput.value = "";
  if (!files.length) return;
  browserStatus().textContent = "Reading game folder…";
  const games = await Promise.all(files.map((file) => browserGame(file).catch(() => null)));
  const imported = games.filter(Boolean);
  for (const game of imported) catalog.set(game.id, game);
  await refreshLibrary();
  browserStatus().textContent = imported.length
    ? "Imported " + imported.length + " games"
    : "No supported browser games found in that folder.";
});

document.getElementById("browser-import-folder").addEventListener("click", () => folderInput.click());
document.getElementById("browser-open-game").addEventListener("click", () => {
  fileForm.reset();
  fileError.textContent = "";
  singleDialog.showModal();
});
document.getElementById("browser-cancel-game").addEventListener("click", () => singleDialog.close());
fileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const game = await browserGame(fileInput.files[0], systemInput.value);
    catalog.set(game.id, game);
    singleDialog.close();
    await refreshLibrary();
    await window.launchGame(game, false);
  } catch (error) {
    fileError.textContent = error.message;
  }
});

function loadClassicScript(filename) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL(filename, document.baseURI).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load " + filename));
    document.head.append(script);
  });
}

loadClassicScript("win31_apps.js")
  .then(() => loadClassicScript("win31.js"))
  .catch((error) => { browserStatus().textContent = error.message; });
