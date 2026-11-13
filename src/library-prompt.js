import { connectDrive, hasDriveConfiguration, libraryFileIdForLaunch, prepareDriveConnection, rememberSelection } from "./drive-auth.js";

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
  const driveTitle = document.getElementById("browser-drive-title");
  const driveDescription = document.getElementById("browser-drive-description");
  const zipInput = document.getElementById("browser-library-zip");
  const folderInput = document.getElementById("browser-library-folder");
  const driveBox = document.getElementById("box-connect-drive");
  const divider = document.getElementById("library-divider");
  let ready = false;
  let busy = false;
  let libraryLoaded = false;

  function updateConnectButton() {
    connectButton.textContent = libraryFileIdForLaunch() ? "Load Family Library" : "Connect Google Drive";
  }

  function updateLibraryTarget() {
    const fileId = libraryFileIdForLaunch();
    const valid = Boolean(fileId);
    if (ready) updateConnectButton();
    driveTitle.textContent = valid ? "Family Library on Google Drive" : "Open from Google Drive";
    driveDescription.textContent = valid
      ? "Sign in with the Google account invited to the family library. If Google asks for approval, select the family ZIP."
      : "Connect Google Drive to open a game library ZIP.";
    changeButton.textContent = valid ? "Switch Google Account" : "Change Drive ZIP";
    if (valid) changeButton.hidden = false;
    downloadLink.hidden = !valid;
    if (!valid) {
      downloadLink.removeAttribute("href");
      intro.textContent = "Open a game library ZIP from your device:";
      return;
    }
    const url = new URL("https://drive.google.com/uc?export=download");
    url.searchParams.set("id", fileId);
    downloadLink.href = url.href;
    intro.textContent = "Download the full ZIP from Google Drive to your computer, then open it here:";
  }

  async function prepare() {
    connectButton.disabled = true;
    changeButton.disabled = true;
    connectButton.textContent = "Preparing Google Drive…";
    try {
      await prepareDriveConnection();
      ready = true;
      updateConnectButton();
    } catch {
      errorText.textContent = "Google Drive could not connect. Try again or open the ZIP from this device.";
      connectButton.textContent = "Retry Google Drive";
    } finally {
      connectButton.disabled = false;
      changeButton.disabled = false;
    }
  }

  function show(message = "") {
    if (busy || dialog.open) return;
    errorText.textContent = message;
    dialog.returnValue = "";
    dialog.showModal();
    if (!message) {
      if (hasDriveConfiguration && !connectButton.hidden) connectButton.focus();
      else if (!downloadLink.hidden) downloadLink.focus();
    }
    if (hasDriveConfiguration && !ready && !connectButton.disabled) void prepare();
  }

  async function connect(switchAccount = false) {
    if (busy) return;
    if (!ready) {
      await prepare();
      return;
    }

    const fileId = libraryFileIdForLaunch();
    const selectFile = switchAccount && !fileId;
    busy = true;
    dialog.close();
    showStatus("Connecting to Google Drive…");
    let message = "";
    let canceled = false;
    try {
      let selection = await connectDrive({ selectFile, switchAccount, restrictedFileId: fileId });
      if (!selection) {
        canceled = true;
        showStatus("Google Drive connection canceled.");
        return;
      }
      showStatus("Reading the game library from Google Drive…");
      const { openDriveLibrary } = await import("./drive-library.js");
      let files;
      try {
        files = await openDriveLibrary({ ...selection, signal: AbortSignal.timeout(45_000) });
      } catch (directError) {
        if (!selectFile && (directError?.status === 403 || directError?.status === 404)) {
          showStatus(fileId
            ? "Approve the family library in Google Drive…"
            : "Select a ZIP in Google Drive to grant access…");
          selection = await connectDrive({
            selectFile: true,
            existingSelection: selection,
            restrictedFileId: fileId,
          });
          if (!selection) {
            canceled = true;
            if (fileId) message = "If the family ZIP was missing, switch Google accounts or ask for a Drive invitation.";
            showStatus("Google Drive connection canceled.");
            return;
          }
          showStatus("Reading the game library from Google Drive…");
          files = await openDriveLibrary({ ...selection, signal: AbortSignal.timeout(45_000) });
        } else {
          throw directError;
        }
      }
      await loadArchiveFiles(files, "drive");
      rememberSelection(selection.fileId, selection.resourceKey);
      libraryLoaded = true;
      changeButton.hidden = false;
    } catch (error) {
      message = driveErrorMessage(error);
      changeButton.hidden = false;
      showStatus(message);
    } finally {
      busy = false;
      if (canceled && fileId) changeButton.hidden = false;
      if (message || canceled) show(message);
    }
  }

  if (hasDriveConfiguration) {
    if (driveBox) driveBox.hidden = false;
    if (divider) divider.hidden = false;
    connectButton.addEventListener("click", () => void connect());
    changeButton.addEventListener("click", () => void connect(true));
  } else {
    if (driveBox) driveBox.hidden = true;
    if (divider) divider.hidden = true;
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
    updateLibraryTarget();
    if (!libraryLoaded && !downloadLink.hidden) show();
  });
  updateLibraryTarget();
  show();
}
