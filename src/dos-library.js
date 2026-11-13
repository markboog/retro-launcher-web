const MAX_DOS_GAME_SIZE = 64 * 1024 * 1024;
const MAX_DOS_FILES = 512;
const HOCUS_SAV_SIZE = 0x3de;
const HOCUS_KEY_BINDINGS = Uint8Array.of(15, 16, 2, 3, 13, 14, 11, 12);
const DOS_CATALOG = Object.freeze({
  alleycat: { title: "Alley Cat", executable: "CAT.EXE" },
  caves: { title: "Crystal Caves", executable: "CC1.EXE" },
  cosmo1: { title: "Cosmo's Cosmic Adventure", executable: "COSMO1.EXE" },
  digger: { title: "Digger (Windmill Classic)", executable: "DIGGER.COM" },
  doom: { title: "DOOM (Shareware v1.9)", executable: "DOOM.EXE" },
  hocus: { title: "Hocus Pocus", batch: "HOCUS.BAT", executable: "HOCUS.EXE" },
  jazz: { title: "Jazz Jackrabbit (Shareware)", batch: "JAZZ.BAT", executable: "JAZZ.EXE" },
  keen1: { title: "Commander Keen: Marooned on Mars", executable: "KEEN1.EXE" },
  liero: { title: "Liero", executable: "LIERO.EXE" },
  omf2097: { title: "One Must Fall 2097", executable: "OMF.EXE" },
  prince: { title: "Prince of Persia", executable: "PRINCE.EXE" },
  raptor: { title: "Raptor: Call of the Shadows", executable: "RAP.EXE" },
  scorch: { title: "Scorched Earth: The Mother of All Games", executable: "SCORCH.EXE" },
  secagent: { title: "Secret Agent", executable: "SAM1.EXE" },
  starcon2: { title: "Star Control II", executable: "STARCON2.COM" },
  wacky: { title: "Wacky Wheels (Shareware)", executable: "WW.EXE", configuredFolder: "WackyWhe/WACKY", configFile: "WACKY.CFG" },
  wolf3d: { title: "Wolfenstein 3D (Episode 1)", executable: "WOLF3D.EXE" },
  xargon: { title: "Xargon", batch: "XARGON.BAT" },
});

function normalizePath(path) {
  return typeof path === "string" ? path.replaceAll("\\", "/") : "";
}

function isSafeDosPath(path) {
  if (!path || path.length > 240 || path.startsWith("/") || /^[a-z]:/i.test(path)) return false;
  const parts = path.split("/");
  return parts.every((part) => part && part !== "." && part !== ".." && !/[\u0000-\u001f\u007f]/.test(part));
}

function isDiscImage(path) {
  const normalized = path.toLowerCase();
  return normalized.split("/").includes("cd") || /\.(?:iso|cue)$/i.test(normalized);
}

function isLauncherConfig(path) {
  const normalized = path.toLowerCase();
  return normalized.split("/").includes(".jsdos") || ["dosbox.conf", "jsdos.json"].includes(normalized.split("/").at(-1));
}

function findStartup(files, recipe) {
  if (recipe.configuredFolder) {
    const folder = recipe.configuredFolder;
    const find = (name) => files.find((file) => file.path.toLowerCase() === `${folder}/${name}`.toLowerCase());
    const configured = find(recipe.executable);
    if (configured && find(recipe.configFile)) return { kind: "command", executable: configured.path, cwd: folder };
  }
  if (recipe.batch) {
    const batch = files.find((file) => file.path.toLowerCase() === recipe.batch.toLowerCase());
    if (batch) return { kind: "batch", path: batch.path };
  }
  if (!recipe.executable) return null;
  const wanted = recipe.executable.toLowerCase();
  const direct = files.find((file) => file.path.toLowerCase() === wanted);
  if (direct) return { kind: "command", executable: direct.path, cwd: "" };
  const matches = files.filter((file) => file.path.split("/").at(-1).toLowerCase() === wanted);
  if (matches.length !== 1) return null;
  const executable = matches[0].path;
  return { kind: "command", executable, cwd: executable.includes("/") ? executable.slice(0, executable.lastIndexOf("/")) : "" };
}

function createHocusDefaultSave() {
  // Hocus SETUP 1.1 writes this TGameConfig shape. Preserve fresh options but
  // leave every saved-game slot and high-score record empty, never carrying
  // the vendor example names/scores or a player's progress into the library.
  const bytes = new Uint8Array(HOCUS_SAV_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint16(0x00, 1, true); // sound on
  view.setUint16(0x02, 1, true); // music on
  view.setUint16(0x04, 0, true); // keyboard controls
  view.setUint16(0x06, 1, true); // normal game speed
  bytes.set(HOCUS_KEY_BINDINGS, 0x16);
  for (let slot = 0; slot < 9; slot += 1) view.setInt16(0x1e + slot * 2, -1, true);
  bytes.fill(1, 0x13e, 0x147); // setup's nine initialized marker bytes; final padding stays 0

  // The setup run selected no Sound FX or music card. These are the matching
  // NONE/4-voice/quality defaults captured from the game's fresh setup output.
  view.setInt16(0x3c4, -1, true); // sound card: none
  view.setUint16(0x3c6, 4, true); // voice count
  view.setUint16(0x3c8, 16, true); // mixing bits
  view.setInt16(0x3ca, -1, true); // music card: none
  view.setUint16(0x3cc, 0, true); // MIDI port: n/a
  view.setUint16(0x3ce, 5, true); // setup sound-card index
  view.setUint16(0x3d0, 3, true); // setup voice index
  view.setUint16(0x3d2, 1, true); // setup mixing quality index
  view.setUint16(0x3d4, 8, true); // setup music-card index
  view.setUint16(0x3d6, 6, true); // setup MIDI-port index
  return bytes;
}

function addFreshHocusSettings(slug, files, startup) {
  if (slug !== "hocus") return files;
  const savePath = startup.kind === "batch" && startup.path.toLowerCase() === "hocus.bat"
    ? "HOCUS/HOCUS.SAV"
    : startup.cwd ? `${startup.cwd}/HOCUS.SAV` : "HOCUS.SAV";
  if (files.some((file) => file.path.toLowerCase() === savePath.toLowerCase())) return files;
  return [...files, { path: savePath, bytes: createHocusDefaultSave() }];
}

function makeDosEntry(slug, rawFiles, { archiveReader } = {}) {
  const recipe = DOS_CATALOG[slug];
  if (!recipe || !Array.isArray(rawFiles)) return null;
  const allFiles = rawFiles
    .map((file) => ({ ...file, path: normalizePath(file.path) }))
    .filter((file) => isSafeDosPath(file.path) && !isDiscImage(file.path) && !isLauncherConfig(file.path));
  const pathCounts = new Map();
  for (const file of allFiles) pathCounts.set(file.path.toLowerCase(), (pathCounts.get(file.path.toLowerCase()) || 0) + 1);
  const files = allFiles.filter((file) => pathCounts.get(file.path.toLowerCase()) === 1 && Number.isSafeInteger(file.size) && file.size > 0);
  const startup = findStartup(files, recipe);
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  const compressedSize = files.reduce((total, file) => total + (Number.isSafeInteger(file.compressedSize) ? file.compressedSize : 0), 0);
  if (!startup || files.length === 0 || files.length > MAX_DOS_FILES || totalSize <= 0 || totalSize > MAX_DOS_GAME_SIZE || compressedSize > MAX_DOS_GAME_SIZE) return null;
  const dos = Object.freeze({
    title: recipe.title,
    startup: Object.freeze(startup.kind === "batch"
      ? { kind: "batch", path: startup.path }
      : { kind: "command", executable: startup.executable, ...(startup.cwd ? { cwd: startup.cwd } : {}) }),
  });
  return {
    name: recipe.title,
    size: totalSize,
    webkitRelativePath: `games/dos/${slug}`,
    dos,
    async loadDos(signal) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
      if (archiveReader) return addFreshHocusSettings(slug, await archiveReader(files, signal), startup);
      const output = [];
      let loadedSize = 0;
      for (const file of files) {
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
        const bytes = new Uint8Array(await file.source.arrayBuffer());
        if (bytes.byteLength !== file.size || bytes.byteLength > MAX_DOS_GAME_SIZE || loadedSize + bytes.byteLength > MAX_DOS_GAME_SIZE) {
          throw new Error("The selected DOS game folder exceeded its declared size.");
        }
        loadedSize += bytes.byteLength;
        output.push({ path: file.path, bytes });
      }
      return addFreshHocusSettings(slug, output, startup);
    },
  };
}

export function catalogDosArchiveEntries(entries, archiveReader) {
  const groups = new Map();
  for (const entry of entries) {
    const path = normalizePath(entry.name);
    if (!isSafeDosPath(path)) continue;
    const parts = path.split("/");
    const dosIndex = parts.findIndex((part, index) => part.toLowerCase() === "dos" && parts[index - 1]?.toLowerCase() === "games");
    if (dosIndex < 0 || parts.length < dosIndex + 3) continue;
    const slug = parts[dosIndex + 1].toLowerCase();
    if (!Object.hasOwn(DOS_CATALOG, slug)) continue;
    const relativePath = parts.slice(dosIndex + 2).join("/");
    if (!isSafeDosPath(relativePath) || isDiscImage(relativePath) || isLauncherConfig(relativePath)) continue;
    if (!groups.has(slug)) groups.set(slug, []);
    groups.get(slug).push({ ...entry, path: relativePath });
  }
  return [...groups.entries()].map(([slug, files]) => makeDosEntry(slug, files, { archiveReader })).filter(Boolean);
}

export function listDosFolderGames(fileList) {
  const files = Array.from(fileList || []);
  const groups = new Map();
  for (const source of files) {
    const path = normalizePath(source.webkitRelativePath || source.name);
    if (!isSafeDosPath(path)) continue;
    const parts = path.split("/");
    const dosIndex = parts.findIndex((part, index) => part.toLowerCase() === "dos" && parts[index - 1]?.toLowerCase() === "games");
    const slug = dosIndex >= 0 ? parts[dosIndex + 1]?.toLowerCase() : parts[0].toLowerCase();
    if (!Object.hasOwn(DOS_CATALOG, slug)) continue;
    const relativePath = dosIndex >= 0 ? parts.slice(dosIndex + 2).join("/") : parts.slice(1).join("/");
    if (!isSafeDosPath(relativePath) || isDiscImage(relativePath) || isLauncherConfig(relativePath)) continue;
    if (!groups.has(slug)) groups.set(slug, []);
    groups.get(slug).push({ path: relativePath, size: source.size, source });
  }
  return [...groups.entries()].map(([slug, groupedFiles]) => makeDosEntry(slug, groupedFiles)).filter(Boolean);
}

export const DOS_GAME_CATALOG = DOS_CATALOG;
