const STORAGE_PREFIX = "retro-browser-edition:legacy:v1:";
const FAVORITES_KEY = STORAGE_PREFIX + "favorites";
const RECENT_KEY = STORAGE_PREFIX + "recent";
const MAX_RECENT = 20;

const PRIVATE_ENDPOINTS = new Set([
  "/api/archive/search",
  "/api/archive/download",
  "/api/launch_tool",
]);

function readIds(key, limit = MAX_RECENT) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value.filter((id) => typeof id === "string" && id.length > 0).slice(0, limit)
      : [];
  } catch {
    return [];
  }
}

function writeIds(key, ids) {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Private browsing and storage-quota failures should not break the launcher.
  }
}

function safeJsonValue(value, seen = new WeakSet(), depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object" || depth > 12) return undefined;
  if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof URL) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const safeArray = value.map((entry) => safeJsonValue(entry, seen, depth + 1));
    seen.delete(value);
    return safeArray.map((entry) => entry === undefined ? null : entry);
  }
  const record = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:file|url|bytes|data|buffer|arraybuffer)$/i.test(key)) continue;
    const safe = safeJsonValue(entry, seen, depth + 1);
    if (safe !== undefined) record[key] = safe;
  }
  seen.delete(value);
  return record;
}

function catalogRecord(game) {
  if (!game || typeof game !== "object" || typeof game.id !== "string" || !game.id) return null;
  return safeJsonValue(game);
}

function responseJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function fileManagerItems(catalog, requestedPath) {
  const path = requestedPath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const parts = path ? path.split("/") : [];
  if (parts.some((part) => !part || part === "." || part === "..")) return null;

  const directories = new Set();
  const files = [];
  for (const game of catalog) {
    const file = game.file;
    const relative = typeof file?.webkitRelativePath === "string" ? file.webkitRelativePath : "";
    const fileParts = relative.split("/").filter(Boolean);
    const leaf = fileParts.pop() || (typeof file?.name === "string" ? file.name : "");
    if (!leaf) continue;

    for (let index = 1; index <= fileParts.length; index += 1) {
      directories.add(fileParts.slice(0, index).join("/"));
    }
    if (fileParts.join("/") === parts.join("/")) {
      const extension = leaf.includes(".") ? "." + leaf.split(".").at(-1).toLowerCase() : "";
      const modified = Number.isFinite(file.lastModified) && file.lastModified > 0
        ? new Date(file.lastModified).toLocaleString()
        : "";
      files.push({
        name: leaf,
        is_dir: false,
        size: Number.isFinite(file.size) ? file.size : 0,
        modified,
        ext: extension,
      });
    }
  }

  const visibleDirectories = [...directories]
    .filter((directory) => {
      const parent = directory.split("/").slice(0, -1).join("/");
      return parent === parts.join("/");
    })
    .map((directory) => ({
      name: directory.split("/").at(-1), is_dir: true, size: 0, modified: "", ext: "",
    }));

  const items = [...visibleDirectories, ...files]
    .sort((left, right) => Number(right.is_dir) - Number(left.is_dir) || left.name.localeCompare(right.name));
  return { current_path: path, items };
}

export function installLegacyApi({ initialGames = [], launch, openLibrary } = {}) {
  const nativeFetch = window.fetch.bind(window);
  let catalog = Array.isArray(initialGames) ? [...initialGames] : [];
  let favorites = readIds(FAVORITES_KEY, 10000);
  let recent = readIds(RECENT_KEY);

  const getCatalog = () => [...catalog];
  const replaceLibrary = (games) => {
    catalog = Array.isArray(games) ? [...games] : [];
    return getCatalog();
  };

  const getRequestDetails = async (input, init) => {
    let url;
    let method = "GET";
    let body = null;
    if (input instanceof Request) {
      url = new URL(input.url, window.location.href);
      method = init?.method || input.method;
      body = init?.body ?? (method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD"
        ? null : await input.clone().text());
    } else {
      url = new URL(String(input), window.location.href);
      method = init?.method || "GET";
      body = init?.body ?? null;
    }
    let payload = {};
    if (typeof body === "string" && body) {
      try { payload = JSON.parse(body); } catch { payload = null; }
    } else if (body instanceof URLSearchParams) {
      payload = Object.fromEntries(body.entries());
    }
    return { url, method: method.toUpperCase(), payload };
  };

  const handleRequest = async (input, init) => {
    const { url, method, payload } = await getRequestDetails(input, init);
    const path = url.pathname;
    if (method === "GET" && path === "/api/capabilities") {
      return responseJson({
        family_mode: true,
        mode: "family",
        private_tools: false,
        archive_access: false,
        capabilities: {
          system_optimizer: false,
          archive_search: false,
          archive_download: false,
          catalog_refresh: true,
        },
      });
    }
    if (method === "GET" && path === "/api/catalog") {
      return responseJson(catalog.map(catalogRecord).filter(Boolean));
    }
    if (method === "GET" && path === "/api/favorites") return responseJson([...favorites]);
    if (method === "GET" && path === "/api/recent") return responseJson([...recent]);

    if (method === "POST" && path === "/api/launch") {
      if (!payload || typeof payload.id !== "string" || typeof payload.setup_mode !== "boolean" && payload.setup_mode !== undefined) {
        return responseJson({ success: false, error: "Invalid launch request" }, 400);
      }
      const game = catalog.find((entry) => entry?.id === payload.id);
      if (!game) return responseJson({ success: false, error: "Game not found in catalog" }, 404);
      if (typeof launch !== "function") return responseJson({ success: false, message: "Game launch is unavailable in this browser." }, 501);
      try {
        const result = await launch(game, payload.setup_mode === true);
        if (result?.success === false || result?.error) {
          return responseJson({ success: false, message: result.message || result.error || "Could not launch game." }, 500);
        }
        const message = typeof result?.message === "string" ? result.message : `Opened ${game.title || "game"}`;
        recent = [game.id, ...recent.filter((id) => id !== game.id)].slice(0, MAX_RECENT);
        writeIds(RECENT_KEY, recent);
        return responseJson({ success: true, message });
      } catch (error) {
        return responseJson({ success: false, message: error instanceof Error ? error.message : "Could not launch game." }, 500);
      }
    }

    if (method === "POST" && path === "/api/scan") {
      if (typeof openLibrary !== "function") return responseJson({ success: false, error: "Library refresh is unavailable." }, 501);
      try {
        const previousIds = new Set(catalog.map((game) => game?.id).filter((id) => typeof id === "string"));
        const result = await openLibrary();
        if (Array.isArray(result)) replaceLibrary(result);
        else if (Array.isArray(result?.games)) replaceLibrary(result.games);
        const count = catalog.length;
        return responseJson({
          success: true,
          total: count,
          added: catalog.filter((game) => game && !previousIds.has(game.id)).length,
          message: `Library refreshed: ${count} games`,
        });
      } catch (error) {
        return responseJson({ success: false, error: error instanceof Error ? error.message : "Library refresh failed." }, 500);
      }
    }

    if (method === "GET" && path === "/api/fs") {
      const listing = fileManagerItems(catalog, url.searchParams.get("path") || "");
      return listing ? responseJson(listing) : responseJson({ error: "Path not found" }, 404);
    }

    if (method === "POST" && path === "/api/favorite") {
      if (!payload || typeof payload.id !== "string" || !payload.id) {
        return responseJson({ success: false, error: "Invalid favorite id" }, 400);
      }
      const isFavorite = !favorites.includes(payload.id);
      favorites = isFavorite
        ? [...favorites, payload.id]
        : favorites.filter((id) => id !== payload.id);
      writeIds(FAVORITES_KEY, favorites);
      return responseJson({ id: payload.id, favorite: isFavorite, total_favorites: favorites.length });
    }

    if (method === "POST" && path === "/api/exit") {
      return responseJson({ message: "Browser launcher closed" });
    }

    if (PRIVATE_ENDPOINTS.has(path)) return responseJson({ error: "Endpoint not available in browser edition" }, 404);
    if (path.startsWith("/api/artwork/") || path === "/api/audio_status" || path === "/api/health") {
      return responseJson({ error: "Endpoint not available in browser edition" }, 404);
    }
    return responseJson({ error: "Endpoint not implemented in browser edition" }, 501);
  };

  window.fetch = (input, init) => {
    let url;
    try {
      url = input instanceof Request
        ? new URL(input.url, window.location.href)
        : new URL(String(input), window.location.href);
    } catch {
      return nativeFetch(input, init);
    }
    if (url.origin !== window.location.origin || !/^\/api(?:\/|$)/.test(url.pathname)) {
      return nativeFetch(input, init);
    }
    return handleRequest(input, init);
  };

  return { replaceLibrary, getCatalog };
}
