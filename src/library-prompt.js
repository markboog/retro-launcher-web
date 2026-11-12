import { connectDrive, hasDriveConfiguration, prepareDriveConnection } from "./drive-auth.js";

const DISMISS_KEY = "retro-library-prompt-dismissed";

export function driveErrorMessage(error) {
  if (error?.status === 401) return "Google Drive access expired. Reconnect to continue.";
  if (error?.status === 403 || error?.status === 404) {
    return "This Google account cannot open the library. Switch accounts or ask for a Drive invitation.";
  }
  if (error?.name === "TimeoutError") return "Google Drive took too long to respond. Try again.";
  return error instanceof Error ? error.message : "Could not open the game library.";
}

export function setupLibraryPrompt({ chooseFolder, loadDriveFiles, showStatus }) {
  const dialog = document.getElementById("browser-library-dialog");
  const errorText = document.getElementById("browser-library-error");
  const connectButton = document.getElementById("browser-connect-drive");
  const changeButton = document.getElementById("browser-change-drive");
  let dismissed = false;
  let ready = false;
  let busy = false;

  try { dismissed = sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { /* Session storage can be blocked. */ }

  async function prepare() {
    connectButton.disabled = true;
    connectButton.textContent = "Preparing Google Drive…";
    try {
      await prepareDriveConnection();
      ready = true;
      connectButton.textContent = "Connect Google Drive";
    } catch {
      errorText.textContent = "Google Drive could not load. Try again or choose a local game folder.";
      connectButton.textContent = "Retry Google Drive";
    } finally {
      connectButton.disabled = false;
    }
  }

  function show(message = "") {
    if (busy || dialog.open) return;
    errorText.textContent = message;
    dialog.returnValue = "";
    dialog.showModal();
    if (hasDriveConfiguration && !ready) void prepare();
  }

  async function connect(selectFile) {
    if (busy) return;
    if (!ready) {
      await prepare();
      return;
    }

    busy = true;
    dialog.close("connect");
    showStatus("Connecting to Google Drive…");
    let message = "";
    let canceled = false;
    try {
      const selection = await connectDrive({ selectFile });
      if (!selection) {
        canceled = true;
        showStatus("Google Drive connection canceled.");
        return;
      }
      showStatus("Reading the game library from Google Drive…");
      const { openDriveLibrary } = await import("./drive-library.js");
      const files = await openDriveLibrary({ ...selection, signal: AbortSignal.timeout(45_000) });
      if (!files.length) throw new Error("This ZIP contains no games the browser launcher can play.");
      await loadDriveFiles(files);
      changeButton.hidden = false;
    } catch (error) {
      message = driveErrorMessage(error);
      changeButton.hidden = false;
      showStatus(message);
    } finally {
      busy = false;
      if (message || canceled) show(message);
    }
  }

  if (hasDriveConfiguration) {
    connectButton.hidden = false;
    document.getElementById("browser-library-intro").textContent =
      "Connect Google Drive to load the shared family ZIP, or choose a game folder from this device.";
    connectButton.addEventListener("click", () => void connect(false));
    changeButton.addEventListener("click", () => void connect(true));
  }
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "connect") return;
    dismissed = true;
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* Session storage can be blocked. */ }
  });
  document.getElementById("browser-choose-folder").addEventListener("click", () => {
    dialog.close();
    chooseFolder();
  });
  document.getElementById("browser-load-library").addEventListener("click", () => show());
  if (!dismissed) show();
}
