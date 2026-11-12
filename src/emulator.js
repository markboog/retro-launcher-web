const EMULATORJS_VERSION = "4.2.3";
const EMULATORJS_DATA_URL = `https://cdn.emulatorjs.org/${EMULATORJS_VERSION}/data/`;
const CORE_START_TIMEOUT_MS = 90_000;

const CORE_BY_SYSTEM = Object.freeze({
  gb: "gb",
  gbc: "gb",
  snes: "snes",
  segaMD: "segaMD",
});

function report(onStatus, state, message) {
  onStatus?.({ state, message });
}

function escapeInlineJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function createPlayerDocument(sessionToken) {
  const token = escapeInlineJson(sessionToken);
  const dataUrl = escapeInlineJson(EMULATORJS_DATA_URL);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: https://cdn.emulatorjs.org/${EMULATORJS_VERSION}/data/; style-src 'unsafe-inline' https://cdn.emulatorjs.org/${EMULATORJS_VERSION}/data/; img-src data: blob: https://cdn.emulatorjs.org/${EMULATORJS_VERSION}/data/; connect-src blob: https://cdn.emulatorjs.org/${EMULATORJS_VERSION}/data/; worker-src blob: data: https://cdn.emulatorjs.org/${EMULATORJS_VERSION}/data/; media-src data: blob: https://cdn.emulatorjs.org/${EMULATORJS_VERSION}/data/; font-src data: https://cdn.emulatorjs.org/${EMULATORJS_VERSION}/data/; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'">
  <link rel="stylesheet" href="${EMULATORJS_DATA_URL}emulator.min.css">
  <style>
    html, body, #game { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #080b0c; }
    body { display: grid; place-items: center; }
  </style>
</head>
<body>
  <main id="game" aria-label="Retro game player"></main>
  <script>
    (() => {
      const sessionToken = ${token};
      const dataUrl = ${dataUrl};
      let romUrl = null;
      let started = false;
      const makeMemoryStorage = () => {
        const entries = new Map();
        return {
          get length() { return entries.size; },
          clear() { entries.clear(); },
          getItem(key) { return entries.get(String(key)) ?? null; },
          key(index) { return Array.from(entries.keys())[Number(index)] ?? null; },
          removeItem(key) { entries.delete(String(key)); },
          setItem(key, value) { entries.set(String(key), String(value)); },
        };
      };
      Object.defineProperty(window, "localStorage", { configurable: true, value: makeMemoryStorage() });
      Object.defineProperty(window, "sessionStorage", { configurable: true, value: makeMemoryStorage() });
      Object.defineProperty(window, "indexedDB", { configurable: true, value: null });
      const send = (state, message, extra = {}) => parent.postMessage({ type: "retro-emulator-status", token: sessionToken, state, message, ...extra }, "*");
      const fail = (message) => send("error", message);

      window.addEventListener("error", (event) => {
        if (event.message) fail("Emulator startup failed: " + event.message);
      });
      window.addEventListener("unhandledrejection", (event) => {
        fail("Emulator startup failed: " + String(event.reason?.message || event.reason || "unknown error"));
      });
      window.addEventListener("message", (event) => {
        if (started || event.source !== parent || event.data?.type !== "retro-start" || event.data?.token !== sessionToken) return;
        started = true;
        const { bytes, core, title } = event.data;
        if (!(bytes instanceof ArrayBuffer) || !Object.hasOwn(${escapeInlineJson(CORE_BY_SYSTEM)}, core)) {
          fail("The selected game or system could not be opened.");
          return;
        }

        romUrl = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
        window.EJS_player = "#game";
        window.EJS_gameUrl = romUrl;
        window.EJS_gameName = String(title).replace(/[<>]/g, "");
        window.EJS_core = core;
        window.EJS_pathtodata = dataUrl;
        window.EJS_volume = 0;
        window.EJS_startOnLoaded = true;
        window.EJS_disableLocalStorage = true;
        window.EJS_disableAutoUnload = false;
        window.EJS_cacheConfig = { enabled: false };
        window.EJS_adUrl = "";
        window.EJS_AdUrl = "";
        window.EJS_ready = () => send("loading", "Emulator ready. Starting game…");
        window.EJS_onGameStart = () => send("ready", "Game running");
        window.EJS_onExit = () => send("loading", "Game closed");

        const loader = document.createElement("script");
        loader.src = dataUrl + "loader.js";
        loader.onerror = () => fail("Could not load EmulatorJS. Check your connection and try again.");
        document.head.append(loader);
        send("loading", "Loading emulator core…");
      });
      send("loading", "Player ready", { playerReady: true });
    })();
  </script>
</body>
</html>`;
}

function validateRomUrl(url) {
  let parsed;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    throw new TypeError("A valid local ROM URL is required.");
  }

  const isLocalBlob = parsed.protocol === "blob:" && parsed.origin === window.location.origin;
  const isSameOriginFile = ["http:", "https:"].includes(parsed.protocol) && parsed.origin === window.location.origin;
  if (!isLocalBlob && !isSameOriginFile) {
    throw new TypeError("ROMs must be local files selected in Retro Launcher.");
  }
  return parsed.href;
}

/**
 * Mount an EmulatorJS player in an isolated iframe. The ROM bytes cross the
 * iframe boundary once and remain in its opaque sandbox; the frame never gets
 * permission to read the host page or its storage.
 */
export async function startGame({ container, system, url, title = "Untitled game", onStatus } = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError("A player container is required.");
  const core = CORE_BY_SYSTEM[system];
  if (!core) throw new TypeError(`Unsupported system: ${String(system)}`);

  let romUrl;
  try {
    romUrl = validateRomUrl(url);
  } catch (error) {
    report(onStatus, "error", error.message);
    throw error;
  }

  const controller = new AbortController();
  const sessionToken = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.title = "Retro game player";
  frame.tabIndex = 0;
  frame.setAttribute("sandbox", "allow-scripts allow-pointer-lock allow-downloads");
  frame.setAttribute("allow", "autoplay; fullscreen; gamepad; screen-wake-lock");
  frame.referrerPolicy = "no-referrer";
  frame.allowFullscreen = true;
  frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:#080b0c";
  frame.srcdoc = createPlayerDocument(sessionToken);

  let stopped = false;
  let gameBytes = null;
  let playerReady = false;
  let romSent = false;
  let startupTimeout;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    window.clearTimeout(startupTimeout);
    gameBytes = null;
    window.removeEventListener("message", receiveStatus);
    frame.remove();
  };
  const sendRomWhenReady = () => {
    if (stopped || romSent || !playerReady || !gameBytes) return;
    romSent = true;
    const bytes = gameBytes;
    gameBytes = null;
    frame.contentWindow?.postMessage({ type: "retro-start", token: sessionToken, bytes, core, title: String(title).slice(0, 160) }, "*", [bytes]);
    frame.focus({ preventScroll: true });
    startupTimeout = window.setTimeout(() => {
      report(onStatus, "error", "The emulator core took too long to start. Check your connection and try again.");
      cleanup();
    }, CORE_START_TIMEOUT_MS);
  };
  const receiveStatus = (event) => {
    if (event.source !== frame.contentWindow || event.data?.type !== "retro-emulator-status" || event.data?.token !== sessionToken) return;
    if (event.data.playerReady === true) {
      playerReady = true;
      sendRomWhenReady();
    }
    if (["loading", "ready", "error"].includes(event.data.state)) {
      report(onStatus, event.data.state, String(event.data.message || ""));
      if (event.data.state === "ready") window.clearTimeout(startupTimeout);
      if (event.data.state === "error") cleanup();
    }
  };

  window.addEventListener("message", receiveStatus);
  container.replaceChildren(frame);
  report(onStatus, "loading", "Reading local game file…");

  const handle = Object.freeze({
    stop: cleanup,
    get canvas() {
      return frame.contentDocument?.querySelector("canvas") ?? null;
    },
  });

  void (async () => {
    try {
      const response = await fetch(romUrl, { signal: controller.signal, credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error(`Local game could not be read (${response.status}).`);
      gameBytes = await response.arrayBuffer();
      if (stopped) return;
      sendRomWhenReady();
    } catch (error) {
      if (stopped || error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "The selected game could not be read.";
      report(onStatus, "error", message);
      cleanup();
    }
  })();

  return handle;
}
