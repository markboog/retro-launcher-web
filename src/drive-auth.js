const GIS_URL = "https://accounts.google.com/gsi/client";
const GAPI_URL = "https://apis.google.com/js/api.js";
const SCRIPT_TIMEOUT_MS = 15_000;
const AUTH_TIMEOUT_MS = 120_000;
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SELECTION_KEY = "retro-drive-selection-v1";

const configuration = () => ({
  clientId: import.meta.env?.VITE_DRIVE_CLIENT_ID?.trim() ?? "",
  projectNumber: import.meta.env?.VITE_DRIVE_PROJECT_NUMBER?.trim() ?? "",
  pickerKey: import.meta.env?.VITE_DRIVE_PICKER_KEY?.trim() ?? "",
});

export const hasDriveConfiguration = Object.values(configuration()).every(Boolean);

let preparePromise;
let pickerLoaded = false;

function loadScript(src, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else resolve();
    };
    const timeout = setTimeout(() => finish(new Error(`Timed out loading Google API: ${src}`)), SCRIPT_TIMEOUT_MS);
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => finish();
    script.onerror = () => finish(new Error(`Could not load Google API: ${src}`));
    document.head.append(script);
  });
}

async function loadPicker() {
  if (pickerLoaded) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out loading Google Picker API")), SCRIPT_TIMEOUT_MS);
    try {
      window.gapi.load("picker", {
        callback: () => { clearTimeout(timeout); pickerLoaded = true; resolve(); },
        onerror: () => { clearTimeout(timeout); reject(new Error("Could not load Google Picker API")); },
        timeout: SCRIPT_TIMEOUT_MS,
        ontimeout: () => { clearTimeout(timeout); reject(new Error("Timed out loading Google Picker API")); },
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

export function prepareDriveConnection() {
  if (!hasDriveConfiguration) return Promise.reject(new Error("Google Drive is not configured for this app."));
  if (!preparePromise) {
    preparePromise = (async () => {
      await loadScript(GIS_URL, () => Boolean(window.google?.accounts?.oauth2));
      await loadScript(GAPI_URL, () => Boolean(window.gapi?.load));
      await loadPicker();
    })().catch((error) => {
      preparePromise = undefined;
      pickerLoaded = false;
      throw error;
    });
  }
  return preparePromise;
}

function requestAccessToken({ prompt = "" } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(reject, new Error("Google Drive authorization timed out. Try connecting again.")), AUTH_TIMEOUT_MS);
    const finish = (complete, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      complete(value);
    };
    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: configuration().clientId,
        scope: DRIVE_FILE_SCOPE,
        callback(response) {
          if (response?.error === "access_denied") finish(resolve, null);
          else if (response?.error || !response?.access_token) {
            finish(reject, new Error("Google Drive authorization did not complete. Try connecting again."));
          } else finish(resolve, { value: response.access_token, expiresAt: Date.now() + Number(response.expires_in || 0) * 1000 });
        },
        error_callback(error) {
          if (error?.type === "popup_closed") finish(resolve, null);
          else if (error?.type === "popup_failed_to_open") {
            finish(reject, new Error("Google sign-in popup could not open. Allow popups for this site and try again."));
          } else finish(reject, new Error("Google sign-in did not open. Try connecting again."));
        },
      });
      tokenClient.requestAccessToken({ prompt });
    } catch (error) {
      finish(reject, error);
    }
  });
}

export function rememberSelection(fileId, resourceKey) {
  try { window.localStorage?.setItem(SELECTION_KEY, JSON.stringify({ fileId, resourceKey: resourceKey || null })); } catch { /* Storage is optional. */ }
}

export function readRememberedSelection() {
  try {
    const value = JSON.parse(window.localStorage?.getItem(SELECTION_KEY) || "null");
    if (typeof value?.fileId === "string" && value.fileId.trim()) {
      return { fileId: value.fileId, resourceKey: typeof value.resourceKey === "string" && value.resourceKey ? value.resourceKey : null };
    }
    if (value !== null) window.localStorage?.removeItem(SELECTION_KEY);
  } catch { /* Storage is optional; malformed values are ignored. */ }
  return null;
}

export function libraryFileIdForLaunch(
  hash = window.location.hash,
  defaultFileId = import.meta.env?.VITE_DEFAULT_LIBRARY_FILE_ID?.trim() ?? "",
) {
  const linkedFileId = new URLSearchParams(hash.slice(1)).get("library");
  const validFileId = /^[A-Za-z0-9_-]{15,150}$/;
  if (linkedFileId && validFileId.test(linkedFileId)) return linkedFileId;
  return validFileId.test(defaultFileId) ? defaultFileId : null;
}

export async function connectDrive({
  selectFile = false,
  existingSelection = null,
  restrictedFileId = null,
  switchAccount = selectFile,
} = {}) {
  if (!pickerLoaded) throw new Error("Prepare the Google Drive connection before connecting.");
  const token = existingSelection
    ? { value: existingSelection.getToken(), getToken: existingSelection.getToken }
    : await requestAccessToken({ prompt: switchAccount ? "select_account" : "" });
  if (!token) return null;
  const getToken = token.getToken || (() => {
    if (Date.now() >= token.expiresAt) {
      const error = new Error("Google Drive access expired. Reconnect to continue.");
      error.status = 401;
      throw error;
    }
    return token.value;
  });

  if (!selectFile) {
    const remembered = readRememberedSelection();
    if (restrictedFileId) {
      return {
        fileId: restrictedFileId,
        resourceKey: remembered?.fileId === restrictedFileId ? remembered.resourceKey : null,
        getToken,
      };
    }
    if (remembered) return { ...remembered, getToken };
  }
  return new Promise((resolve, reject) => {
    const { projectNumber, pickerKey } = configuration();
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS);
    view.setMimeTypes("application/zip,application/x-zip-compressed");
    view.setIncludeFolders(false);
    view.setMode(window.google.picker.DocsViewMode.LIST);
    if (restrictedFileId) {
      if (typeof view.setFileIds !== "function") {
        reject(new Error("Google Picker cannot restrict this selection to the required Drive file."));
        return;
      }
      view.setFileIds(restrictedFileId);
    }
    // Leaving ownership unset shows owned files and files shared with the user.
    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token.value)
      .setDeveloperKey(pickerKey)
      .setAppId(projectNumber)
      .setTitle(restrictedFileId
        ? "Select this RetroLauncher game library ZIP"
        : "Select your RetroLauncher game library ZIP")
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.CANCEL) resolve(null);
        if (data.action !== window.google.picker.Action.PICKED) return;
        const doc = data.docs?.[0];
        if (!doc?.id) { reject(new Error("Google Picker did not return a file ID.")); return; }
        if (restrictedFileId && doc.id !== restrictedFileId) {
          reject(new Error("Google Picker returned a different file than the required RetroLauncher library."));
          return;
        }
        resolve({ fileId: doc.id, resourceKey: doc.resourceKey || null, getToken });
      })
      .build();
    picker.setVisible(true);
  });
}
