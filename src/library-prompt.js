import { connectDrive, hasDriveConfiguration, prepareDriveConnection } from "./drive-auth.js";

export function driveErrorMessage(error) {
  if (error?.status === 401) return "Google Drive access expired. Reconnect to continue.";
  if (error?.status === 403 || error?.status === 404) {
    return "This Google account cannot open the library. Switch accounts or ask for a Drive invitation.";
  }
  if (error?.name === "TimeoutError") return "Google Drive took too long to respond. Try again.";
  return error instanceof Error ? error.message : "Could not open the game library.";
}

export function setupLibraryPrompt({ loadFolderFiles, loadArchiveFiles, showStatus }) {
  const dialog = document.getElementById("browser-library-dialog");
  const intro = document.getElementById("browser-library-intro");
  const errorText = document.getElementById("browser-library-error");
  const downloadLink = document.getElementById("browser-download-library");
  const connectButton = document.getElementById("browser-connect-drive");
  const changeButton = document.getElementById("browser-change-drive");
  const zipInput = document.getElementById("browser-library-zip");
  const folderInput = document.getElementById("browser-library-folder");
  const defaultIntro = intro.textContent;
  let ready = false;
  let busy = false;
  let libraryLoaded = false;

  function updateDownloadLink() {
    const fileId = new URLSearchParams(window.location.hash.slice(1)).get("library");
    const valid = fileId && /^[A-Za-z0-9_-]{15,150}$/.test(fileId);
    downloadLink.hidden = !valid;
    if (!valid) {
      downloadLink.removeAttribute("href");
      intro.textContent = defaultIntro;
      return;
    }
    const url = new URL("https://drive.google.com/uc?export=download");
    url.searchParams.set("id", fileId);
    downloadLink.href = url.href;
    intro.textContent = "Download the family ZIP from Google Drive. When it finishes, return here and open the ZIP from Downloads.";
  }

  async function prepare() {
    connectButton.disabled = true;
    connectButton.textContent = "Preparing Google Drive…";
    try {
      await prepareDriveConnection();
      ready = true;
      connectButton.textContent = "Connect Google Drive";
    } catch {
      errorText.textContent = "Google Drive could not connect. Try again or open the ZIP from this device.";
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
    if (!message && !downloadLink.hidden) downloadLink.focus();
    if (hasDriveConfiguration && !ready && !connectButton.disabled) void prepare();
  }

  async function connect(selectFile) {
    if (busy) return;
    if (!ready) {
      await prepare();
      return;
    }

    busy = true;
    dialog.close();
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
      await loadArchiveFiles(files, "drive");
      libraryLoaded = true;
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
    connectButton.addEventListener("click", () => void connect(false));
    changeButton.addEventListener("click", () => void connect(true));
  }
  async function loadLocal(status, load) {
    if (busy) return;
    busy = true;
    if (dialog.open) dialog.close();
    showStatus(status);
    let message = "";
    try {
      await load();
      libraryLoaded = true;
    } catch (error) {
      message = error?.name === "TimeoutError"
        ? "Reading the ZIP took too long. Make sure it’s available on this device, then try again."
        : error instanceof Error ? error.message : "Could not load the game library.";
      showStatus(message);
    } finally {
      busy = false;
      if (message) show(message);
    }
  }

  document.getElementById("browser-choose-zip").addEventListener("click", () => zipInput.click());
  zipInput.addEventListener("change", () => {
    const file = zipInput.files[0];
    zipInput.value = "";
    if (!file) return;
    void loadLocal("Reading the game library ZIP…", async () => {
      const { openLocalLibrary } = await import("./drive-library.js");
      const files = await openLocalLibrary(file, AbortSignal.timeout(45_000));
      await loadArchiveFiles(files, "zip");
    });
  });
  const chooseFolder = () => folderInput.click();
  document.getElementById("browser-choose-folder").addEventListener("click", chooseFolder);
  document.getElementById("browser-import-folder").addEventListener("click", chooseFolder);
  folderInput.addEventListener("change", () => {
    const files = Array.from(folderInput.files);
    folderInput.value = "";
    if (files.length) void loadLocal("Reading game folder…", () => loadFolderFiles(files));
  });
  document.getElementById("browser-load-library").addEventListener("click", () => show());
  window.addEventListener("hashchange", () => {
    updateDownloadLink();
    if (!libraryLoaded && !downloadLink.hidden) show();
  });
  updateDownloadLink();
  show();
}
