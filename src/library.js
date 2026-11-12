export const SYSTEMS = Object.freeze({
  gb: "Game Boy",
  gbc: "Game Boy Color",
  snes: "Super Nintendo",
  segaMD: "Genesis / Mega Drive",
});

const FORMATS = new Map([
  ["gb", "gb"],
  ["gbc", "gbc"],
  ["sfc", "snes"],
  ["smc", "snes"],
  ["md", "segaMD"],
  ["gen", "segaMD"],
]);
const FOLDERS = new Map([
  ["gb", "gb"],
  ["gbc", "gbc"],
  ["snes", "snes"],
  ["md", "segaMD"],
  ["genesis", "segaMD"],
]);

export function describeFile(file, chosenSystem = "") {
  if (!file.size) throw new Error("The game file is empty.");
  if (file.size > 64 * 1024 * 1024) {
    throw new Error("Choose a single game under 64 MB, or open the library ZIP from File → Load Game Library.");
  }
  const extension = file.name.split(".").at(-1).toLowerCase();
  const direct = FORMATS.get(extension);
  if (!direct && extension !== "zip" && extension !== "bin") {
    throw new Error("This file format is unsupported. Choose a cartridge ROM or a ZIP containing one game.");
  }

  const path = file.webkitRelativePath || "";
  const folderSystem = path.split("/").slice(0, -1)
    .map((part) => FOLDERS.get(part.toLowerCase())).find(Boolean);
  const system = Object.hasOwn(SYSTEMS, chosenSystem)
    ? chosenSystem : direct || folderSystem;
  if (!system) throw new Error("Choose a system for this ZIP or BIN file.");
  const stem = file.name.slice(0, -extension.length - 1);
  const title = stem.replace(/^\d+[\s._-]+/, "")
    .replace(/\s*\[[^\]]*\]|\s*\([^)]*\)/g, "").trim() || stem || file.name;

  return {
    id: path ? "folder:" + path : "file:" + system + ":" + file.name,
    title,
    system,
    file,
  };
}
