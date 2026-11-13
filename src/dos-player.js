const JSDOS_VERSION = "8.4.0";
const JSDOS_ROOT = `https://cdn.jsdelivr.net/npm/js-dos@${JSDOS_VERSION}/dist/`;
const JSDOS_EMULATORS = `https://cdn.jsdelivr.net/npm/emulators@${JSDOS_VERSION}/dist/`;
const MAX_FILES = 2048;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const START_TIMEOUT_MS = 90_000;
const STOP_GRACE_MS = 500;

function report(onStatus, state, message) {
  try {
    onStatus?.({ state, message });
  } catch {
    // Status UI failures must not strand an emulator worker.
  }
}

function abortError() {
  return new DOMException("DOS game launch was cancelled.", "AbortError");
}

function validDosPath(value, label, { shortNames = true } = {}) {
  const maximumLength = shortNames ? 128 : 240;
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength) {
    throw new TypeError(`${label} must be a relative DOS path.`);
  }
  const segments = value.replaceAll("\\", "/").split("/");
  const segmentPattern = shortNames
    ? /^[a-z0-9_$~!#()@{}-]{1,8}(?:\.[a-z0-9]{1,3})?$/i
    : /^[^<>:"|?*\u0000-\u001f\u007f]+$/u;
  const safeSegments = segments.every((segment) =>
    segment !== "" && segment !== "." && segment !== ".." &&
    !segment.endsWith(".") && !segment.endsWith(" ") && segmentPattern.test(segment)
  );
  if (!safeSegments || value.includes(":")) {
    throw new TypeError(`${label} must be a relative DOS 8.3 path.`);
  }
  return segments.join("/");
}

function withWorkingDirectory(path, cwd) {
  if (!cwd) return path;
  const prefix = `${cwd}/`;
  if (path.toUpperCase().startsWith(prefix.toUpperCase())) return path.slice(prefix.length);
  if (path.includes("/")) throw new TypeError("The startup path conflicts with its working folder.");
  return path;
}

function validateStartup(startup, filePaths) {
  if (!startup || typeof startup !== "object") {
    throw new TypeError("A DOS startup recipe is required.");
  }
  const cwd = startup.cwd == null ? null : validDosPath(startup.cwd, "Startup folder");
  if (startup.kind === "command") {
    const fullExecutable = validDosPath(startup.executable, "Startup executable");
    const executable = withWorkingDirectory(fullExecutable, cwd);
    if (!/\.(COM|EXE)$/i.test(executable)) {
      throw new TypeError("The startup executable must end in .COM or .EXE.");
    }
    const targetPath = cwd ? `${cwd}/${executable}` : fullExecutable;
    if (!filePaths.has(targetPath.toLowerCase())) throw new TypeError("The startup executable is missing from the selected game files.");
    const args = startup.args ?? [];
    if (!Array.isArray(args) || args.length > 32 || args.some((arg) =>
      typeof arg !== "string" || arg.length > 80 || !/^[a-z0-9_./:+-]*$/i.test(arg)
    )) {
      throw new TypeError("DOS startup arguments contain unsupported characters.");
    }
    return [cwd && `cd ${cwd}`, `${executable}${args.length ? ` ${args.join(" ")}` : ""}`].filter(Boolean);
  }
  if (startup.kind === "batch") {
    const fullPath = validDosPath(startup.path, "Startup batch file");
    const path = withWorkingDirectory(fullPath, cwd);
    if (!/\.BAT$/i.test(path)) throw new TypeError("The startup batch file must end in .BAT.");
    const targetPath = cwd ? `${cwd}/${path}` : fullPath;
    if (!filePaths.has(targetPath.toLowerCase())) throw new TypeError("The startup batch file is missing from the selected game files.");
    return [cwd && `cd ${cwd}`, path].filter(Boolean);
  }
  throw new TypeError("Unsupported DOS startup recipe.");
}

function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
    throw new TypeError("The DOS game files are missing or exceed the file limit.");
  }
  let totalBytes = 0;
  const seen = new Set();
  return files.map((file) => {
    const path = validDosPath(file?.path, "Game file", { shortNames: false });
    const pathKey = path.toLowerCase();
    const basename = pathKey.split("/").at(-1);
    if (basename === "dosbox.conf" || basename === "jsdos.json" || pathKey.split("/").includes(".jsdos")) {
      throw new TypeError(`The DOS game includes a reserved runtime path: ${path}`);
    }
    if (seen.has(pathKey)) throw new TypeError(`The DOS game contains a duplicate path: ${path}`);
    seen.add(pathKey);
    if (!(file.bytes instanceof Uint8Array)) throw new TypeError(`Game file ${path} has invalid data.`);
    totalBytes += file.bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) throw new RangeError("The selected DOS game is larger than 512 MiB.");
    return { path, bytes: file.bytes };
  });
}

function inlineJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function createPlayerDocument(token) {
  const safeToken = inlineJson(token);
  const root = inlineJson(JSDOS_ROOT);
  const emulatorRoot = inlineJson(JSDOS_EMULATORS);
  const allowSources = `${JSDOS_ROOT} ${JSDOS_EMULATORS}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: ${allowSources}; style-src 'unsafe-inline' ${allowSources}; img-src data: blob: ${allowSources}; connect-src blob: ${allowSources}; worker-src blob: data: ${allowSources}; media-src data: blob: ${allowSources}; font-src data: ${allowSources}; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'">
<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="${JSDOS_ROOT}js-dos.css">
<style>html,body,#player{margin:0;width:100%;height:100%;overflow:hidden;background:#090b0c}body{display:flex}#player{min-height:0}</style></head>
<body><main id="player" aria-label="DOS game player"></main><script>
(() => {
  const token = ${safeToken};
  const root = ${root};
  const emulatorRoot = ${emulatorRoot};
  let props = null;
  let stopped = false;
  let startup = false;
  const send = (state, message, extra = {}) => parent.postMessage({ type: "retro-dos-status", token, state, message, ...extra }, "*");
  const fail = (message) => send("error", message);
  const config = (commands) => [
    "[sdl]", "fullscreen=false", "[autoexec]",
    "mount c .", "c:", ...commands, ""
  ].join("\\n");

  window.addEventListener("error", (event) => { if (event.message) fail("DOSBox could not start."); });
  window.addEventListener("unhandledrejection", () => fail("DOSBox could not start."));
  window.addEventListener("message", async (event) => {
    if (event.source !== parent || event.data?.token !== token) return;
    if (event.data.type === "retro-dos-stop") {
      if (stopped) return;
      stopped = true;
      try { await props?.stop(); } catch { /* Removing the frame also terminates its workers. */ }
      send("stopped", "DOSBox closed");
      return;
    }
    if (startup || event.data.type !== "retro-dos-start") return;
    startup = true;
    const { files, commands } = event.data;
    try {
      if (!Array.isArray(files) || !Array.isArray(commands) || stopped) throw new Error("invalid session");
      send("loading", "Loading DOSBox runtime…");
      const script = document.createElement("script");
      script.src = root + "js-dos.js";
      script.onload = () => {
        if (stopped) return;
        try {
          if (typeof window.Dos !== "function") throw new Error("DOSBox API unavailable");
          props = window.Dos(document.getElementById("player"), {
            dosboxConf: config(commands),
            initFs: files.map(({ path, bytes }) => ({ path, contents: bytes })),
            pathPrefix: emulatorRoot,
            theme: "dark",
            lang: "en",
            volume: 0,
            autoStart: true,
            autoSave: false,
            fsChanges: { local: false },
            workerThread: true,
            offscreenCanvas: false,
            mouseCapture: false,
            startIpxServer: false,
            onEvent: (name, ci) => {
              if (stopped) return;
              if (name === "emu-ready") send("loading", "Starting DOSBox…");
              if (name === "ci-ready") {
                try { ci?.mute?.(); } catch { /* Initial volume is zero as a second guard. */ }
                send("ready", "Game running");
              }
            },
          });
          props.setNoCloud?.(true);
          props.setVolume?.(0);
          send("loading", "Preparing local game files…");
        } catch {
          fail("DOSBox could not initialize this game.");
        }
      };
      script.onerror = () => fail("Could not load the pinned js-dos runtime. Check your connection and try again.");
      document.head.append(script);
    } catch {
      fail("The selected DOS game could not be opened.");
    }
  });
  send("loading", "Player ready", { playerReady: true });
})();
</script></body></html>`;
}

/**
 * Start a DOSBox game in an opaque-origin iframe. The virtual files are sent
 * once to that frame; neither they nor emulator save data are uploaded or
 * persisted by js-dos. A caller-provided AbortSignal closes startup and runtime.
 */
export async function startDosGame({ container, title = "DOS game", files, startup, onStatus, signal } = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError("A DOS player container is required.");
  if (signal?.aborted) throw abortError();

  let checkedFiles;
  let commands;
  try {
    checkedFiles = validateFiles(files);
    commands = validateStartup(startup, new Set(checkedFiles.map(({ path }) => path.toLowerCase())));
  } catch (error) {
    report(onStatus, "error", error.message);
    throw error;
  }

  const token = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.title = `${String(title).slice(0, 120)} — DOS game player`;
  frame.tabIndex = 0;
  frame.setAttribute("sandbox", "allow-scripts allow-pointer-lock");
  frame.setAttribute("allow", "autoplay; fullscreen");
  frame.referrerPolicy = "no-referrer";
  frame.allowFullscreen = true;
  frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:#090b0c";
  frame.srcdoc = createPlayerDocument(token);

  let stopped = false;
  let closing = false;
  let playerReady = false;
  let sent = false;
  let startupTimer;
  let stopTimer;
  let readySettled = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Consumers may use `onStatus` alone; keep a rejected boot promise handled
  // while preserving its rejection for callers that explicitly await it.
  ready.catch(() => {});
  const failReady = (error) => {
    if (readySettled) return;
    readySettled = true;
    rejectReady(error);
  };
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    closing = true;
    clearTimeout(startupTimer);
    clearTimeout(stopTimer);
    signal?.removeEventListener("abort", onAbort);
    window.removeEventListener("message", receiveStatus);
    checkedFiles = [];
    frame.remove();
  };
  const stop = () => {
    if (stopped || closing) return;
    closing = true;
    failReady(abortError());
    try { frame.contentWindow?.postMessage({ type: "retro-dos-stop", token }, "*"); } catch { /* Frame may already be unloading. */ }
    stopTimer = window.setTimeout(cleanup, STOP_GRACE_MS);
  };
  const onAbort = () => stop();
  const sendFilesWhenReady = () => {
    if (stopped || closing || sent || !playerReady) return;
    sent = true;
    const payloadFiles = checkedFiles.map(({ path, bytes }) => {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return { path, bytes: new Uint8Array(buffer) };
    });
    const transfer = payloadFiles.map(({ bytes }) => bytes.buffer);
    checkedFiles = [];
    frame.contentWindow?.postMessage({ type: "retro-dos-start", token, files: payloadFiles, commands }, "*", transfer);
    frame.focus({ preventScroll: true });
  };
  const receiveStatus = (event) => {
    if (stopped || event.source !== frame.contentWindow || event.data?.type !== "retro-dos-status" || event.data?.token !== token) return;
    if (closing) {
      if (event.data.state === "stopped") cleanup();
      return;
    }
    if (event.data.playerReady === true) {
      playerReady = true;
      sendFilesWhenReady();
    }
    if (["loading", "ready", "error"].includes(event.data.state)) {
      report(onStatus, event.data.state, String(event.data.message || ""));
      if (event.data.state === "ready") clearTimeout(startupTimer);
      if (event.data.state === "ready" && !readySettled) {
        readySettled = true;
        resolveReady();
      }
      if (event.data.state === "error") {
        failReady(new Error(String(event.data.message || "DOSBox startup failed.")));
        stop();
      }
    }
  };

  window.addEventListener("message", receiveStatus);
  signal?.addEventListener("abort", onAbort, { once: true });
  container.replaceChildren(frame);
  startupTimer = window.setTimeout(() => {
    const error = new Error("DOSBox took too long to start. Check your connection and try again.");
    report(onStatus, "error", error.message);
    failReady(error);
    stop();
  }, START_TIMEOUT_MS);
  report(onStatus, "loading", "Preparing local DOS files…");
  return Object.freeze({ stop, frame, ready });
}
