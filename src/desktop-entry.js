import "./desktop.css";
import { describeFile, SYSTEMS } from "./library.js";
import { installLegacyApi } from "./legacy-api.js";
import { driveErrorMessage, setupLibraryPrompt } from "./library-prompt.js";
import { listDosFolderGames } from "./dos-library.js";

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
const archiveGameIds = new Set();
const singleDialog = document.getElementById("browser-game-dialog");
const fileForm = document.getElementById("browser-game-form");
const fileInput = document.getElementById("browser-game-file");
const systemInput = document.getElementById("browser-game-system");
const fileError = document.getElementById("browser-game-error");
const browserStatus = () => document.getElementById("status-selection");
const showStatus = (message) => { browserStatus().textContent = message; };
const windowId = "browser-game-player";

window.retroBrowserArtwork = (id) => id === demo.id
  ? new URL("./demo/source/images/screenshot_bw.png", document.baseURI).href
  : null;

const archiveLabels = { drive: "Google Drive", zip: "the library ZIP" };

async function browserGame(source, system, archive) {
  if (source?.dos) {
    return {
      id: `browser_dos:${source.webkitRelativePath.toLowerCase()}`,
      title: source.dos.title,
      system: "dos",
      platform: "dos",
      filename: source.name,
      genre: "Classic",
      desc: "MS-DOS game. Runs inside the browser with DOSBox.",
      archive,
      loadDos: source.loadDos,
      startup: source.dos.startup,
    };
  }
  const { file, ...info } = describeFile(source, system);
  const input = new TextEncoder().encode(archive ? `${archive}:${info.id}` : info.id);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  const id = "browser_" + Array.from(bytes.slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    ...info,
    ...(archive ? { archive, loadFile: (signal) => source.load(signal) } : { file }),
    id,
    platform: info.system === "segaMD" ? "md" : info.system,
    filename: file.name,
    genre: "Classic",
    desc: `${SYSTEMS[info.system]} game from ${archiveLabels[archive] ?? "this device"}.`,
  };
}

let activeSession = null;

async function play(game, setupMode) {
  const isDos = game.system === "dos" && typeof game.loadDos === "function";
  if (setupMode || (!isDos && !Object.hasOwn(SYSTEMS, game.system))) {
    return { success: false, message: "This game needs the Windows edition." };
  }

  window.closeWindow(windowId);
  const width = Math.max(260, Math.min(720, window.innerWidth - 42));
  const height = Math.max(230, Math.min(540, window.innerHeight - 140));
  const icon = isDos ? "icons/floppy.svg" : "icons/gameboy.svg";
  const win = window.createMdiWindow(windowId, game.title, icon, 32, 26, width, height, true);
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

  const controller = new AbortController();
  const session = { player: null, release: null };
  activeSession = session;
  window.registerWindowCleanup(windowId, () => {
    controller.abort();
    session.player?.stop();
    session.release?.();
    if (activeSession === session) activeSession = null;
  });

  try {
    if (game.archive) progress.textContent = `Loading game from ${archiveLabels[game.archive]}…`;
    const loadSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(isDos ? 90_000 : 45_000)]);
    const playerOptions = {
      container: display,
      title: game.title,
      onStatus({ state, message }) {
        if (activeSession !== session) return;
        progress.textContent = message;
        if (state === "error") browserStatus().textContent = message;
      },
    };
    let handle;
    if (isDos) {
      const [{ startDosGame }, files] = await Promise.all([import("./dos-player.js"), game.loadDos(loadSignal)]);
      controller.signal.throwIfAborted();
      handle = await startDosGame({ ...playerOptions, files, startup: game.startup, signal: controller.signal });
    } else {
      const fileRequest = game.loadFile ? game.loadFile(loadSignal) : game.file;
      const [{ startGame }, file] = await Promise.all([import("./emulator.js"), fileRequest]);
      controller.signal.throwIfAborted();
      const url = file ? URL.createObjectURL(file) : game.url;
      if (file) session.release = () => URL.revokeObjectURL(url);
      handle = await startGame({ ...playerOptions, system: game.system, url });
    }
    if (activeSession !== session) {
      handle.stop();
      return { success: false, canceled: true };
    }
    session.player = handle;
    if (isDos) await handle.ready;
    if (activeSession !== session) return { success: false, canceled: true };
    return { success: true, message: "Opened " + game.title + " in the browser player" };
  } catch (error) {
    if (activeSession !== session) return { success: false, canceled: true };
    progress.textContent = game.archive === "drive" ? driveErrorMessage(error)
      : error instanceof Error ? error.message : "The game player could not start.";
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

async function loadArchiveFiles(files, source) {
  if (!files.length) throw new Error("This ZIP contains no games the browser launcher can play.");
  const games = await Promise.all(files.map((file) => browserGame(file, "", source)));
  for (const id of archiveGameIds) catalog.delete(id);
  archiveGameIds.clear();
  for (const game of games) {
    catalog.set(game.id, game);
    archiveGameIds.add(game.id);
  }
  await refreshLibrary();
  showStatus(`Loaded ${games.length} ${games.length === 1 ? "game" : "games"} from ${archiveLabels[source]}.`);
}

async function loadFolderFiles(files) {
  const candidates = [...files, ...listDosFolderGames(files)];
  const games = await Promise.all(candidates.map((file) => browserGame(file).catch(() => null)));
  const imported = games.filter(Boolean);
  if (!imported.length) throw new Error("No supported browser games found in that folder.");
  for (const game of imported) catalog.set(game.id, game);
  await refreshLibrary();
  showStatus(`Imported ${imported.length} ${imported.length === 1 ? "game" : "games"} from the folder.`);
}

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
  .then(() => setupLibraryPrompt({ loadFolderFiles, loadArchiveFiles, showStatus }))
  .catch((error) => { browserStatus().textContent = error.message; });
