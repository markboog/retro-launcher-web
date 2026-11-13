import { deflateRawSync } from "node:zlib";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { openLocalLibrary } from "../src/drive-library.js";
import { listDosFolderGames } from "../src/dos-library.js";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeArchive(items) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name);
    const raw = Buffer.from(item.data);
    const method = item.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(raw) : raw;
    const checksum = crc32(raw);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + compressed.length;
  }
  const directory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, directory, end]);
}

const familyPath = "RetroLauncher-Family-Windows-x64/games/dos";

test("catalogs DOS titles from native recipes and extracts a selected folder with size and CRC checks", async () => {
  const executable = Buffer.from([0x4d, 0x5a, 1, 2]);
  const resource = Buffer.from("shareware data");
  const archive = makeArchive([
    { name: `${familyPath}/doom/DOOM.EXE`, data: executable },
    { name: `${familyPath}/doom/DOOM1.WAD`, data: resource },
    { name: `${familyPath}/doom/cd/disc.iso`, data: "unsupported disc" },
    { name: `${familyPath}/hocus/HOCUS/HOCUS.EXE`, data: executable },
    { name: `${familyPath}/hocus/HOCUS/LEVEL1.DAT`, data: resource },
    { name: `${familyPath}/hocus/cd/HOCUS POCUS.iso`, data: "unsupported disc" },
    { name: `${familyPath}/wacky/WW.EXE`, data: executable },
    { name: `${familyPath}/wacky/WackyWhe/WACKY/WW.EXE`, data: executable },
    { name: `${familyPath}/wacky/WackyWhe/WACKY/WACKY.CFG`, data: "preconfigured" },
    { name: `${familyPath}/wacky/dosbox.conf`, data: "launcher config" },
    { name: `${familyPath}/wacky/jsdos.json`, data: "launcher metadata" },
    { name: `${familyPath}/xargon/XARGON.BAT`, data: "XARGON.EXE" },
    { name: `${familyPath}/xargon/LEVEL.DAT`, data: resource },
    { name: "elsewhere/doom/DOOM.EXE", data: executable },
    { name: `${familyPath}/../outside/DOOM.EXE`, data: executable },
  ]);
  const entries = await openLocalLibrary(new Blob([archive]));
  const dos = entries.filter((entry) => entry.dos);
  assert.deepEqual(dos.map((entry) => entry.webkitRelativePath), ["games/dos/doom", "games/dos/hocus", "games/dos/wacky", "games/dos/xargon"]);
  assert.deepEqual(dos.map((entry) => entry.dos.title), ["DOOM (Shareware v1.9)", "Hocus Pocus", "Wacky Wheels (Shareware)", "Xargon"]);
  assert.deepEqual(dos[0].dos.startup, { kind: "command", executable: "DOOM.EXE" });
  assert.deepEqual(dos[1].dos.startup, { kind: "command", executable: "HOCUS/HOCUS.EXE", cwd: "HOCUS" });
  assert.deepEqual(dos[2].dos.startup, {
    kind: "command", executable: "WackyWhe/WACKY/WW.EXE", cwd: "WackyWhe/WACKY",
  });
  assert.deepEqual(dos[3].dos.startup, { kind: "batch", path: "XARGON.BAT" });
  const files = await dos[1].loadDos();
  assert.deepEqual(files.map(({ path }) => path), ["HOCUS/HOCUS.EXE", "HOCUS/LEVEL1.DAT", "HOCUS/HOCUS.SAV"]);
  assert.deepEqual(Buffer.from(files[0].bytes), executable);
  assert.deepEqual(Buffer.from(files[1].bytes), resource);
  assert.equal(dos[1].size, executable.length + resource.length);
  const save = files[2].bytes;
  assert.equal(save.byteLength, 0x3de);
  const saveView = new DataView(save.buffer, save.byteOffset, save.byteLength);
  assert.deepEqual(Array.from({ length: 9 }, (_, index) => saveView.getInt16(0x1e + index * 2, true)), Array(9).fill(-1));
  assert.deepEqual(Array.from(save.subarray(0x54, 0x13e)), Array(9 * 26).fill(0), "no saved-game names or progress are present");
  assert.deepEqual(Array.from(save.subarray(0x148, 0x3c4)), Array(9 * 4 + 20 * 26 + 20 * 4).fill(0), "save scores and vendor high scores are empty");
  assert.deepEqual((await dos[2].loadDos()).map(({ path }) => path), [
    "WW.EXE", "WackyWhe/WACKY/WW.EXE", "WackyWhe/WACKY/WACKY.CFG",
  ]);
});

test("prefers Hocus's shipped first-run batch and preserves an existing local HOCUS.SAV", async () => {
  const saved = Buffer.from([90, 65, 86]);
  const batch = Uint8Array.from([1, 2, 3]);
  const executable = Uint8Array.from([4, 5]);
  const files = [
    { name: "HOCUS.BAT", webkitRelativePath: "games/dos/hocus/HOCUS.BAT", size: batch.length, async arrayBuffer() { return batch.buffer; } },
    { name: "HOCUS.EXE", webkitRelativePath: "games/dos/hocus/HOCUS/HOCUS.EXE", size: executable.length, async arrayBuffer() { return executable.buffer; } },
    { name: "HOCUS.SAV", webkitRelativePath: "games/dos/hocus/HOCUS/HOCUS.SAV", size: saved.length, async arrayBuffer() { return saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength); } },
  ];
  const [entry] = listDosFolderGames(files);
  assert.deepEqual(entry.dos.startup, { kind: "batch", path: "HOCUS.BAT" });
  const loaded = await entry.loadDos();
  const saves = loaded.filter((file) => file.path.toLowerCase().split("/").at(-1) === "hocus.sav");
  assert.equal(saves.length, 1);
  assert.deepEqual(Buffer.from(saves[0].bytes), saved);
});

test("local extracted-folder imports remain lazy and preserve game-relative member paths", async () => {
  let reads = 0;
  const files = [
    { name: "KEEN1.EXE", webkitRelativePath: "RetroLauncher/games/dos/keen1/KEEN1.EXE", size: 3, async arrayBuffer() { reads += 1; return Uint8Array.from([1, 2, 3]).buffer; } },
    { name: "LEVEL01.CK1", webkitRelativePath: "RetroLauncher/games/dos/keen1/LEVEL01.CK1", size: 2, async arrayBuffer() { reads += 1; return Uint8Array.from([8, 9]).buffer; } },
    { name: "ignored.iso", webkitRelativePath: "RetroLauncher/games/dos/keen1/cd/game.iso", size: 9, async arrayBuffer() { reads += 1; return new ArrayBuffer(9); } },
  ];
  const [entry] = listDosFolderGames(files);
  assert.equal(entry.webkitRelativePath, "games/dos/keen1");
  assert.equal(entry.dos.title, "Commander Keen: Marooned on Mars");
  assert.equal(reads, 0, "folder files are not read while building the catalog");
  const loaded = await entry.loadDos();
  assert.equal(reads, 2, "disc image files remain excluded");
  assert.deepEqual(loaded.map(({ path }) => path), ["KEEN1.EXE", "LEVEL01.CK1"]);
  assert.deepEqual([...loaded[0].bytes], [1, 2, 3]);
});

test("uses the original DOS bootstraps when the library contains multiple entry points", async () => {
  const archive = makeArchive([
    { name: `${familyPath}/starcon2/STARCON2.EXE`, data: [1] },
    { name: `${familyPath}/starcon2/STARCON2.COM`, data: [2] },
    { name: `${familyPath}/jazz/JAZZ.BAT`, data: "JAZZ.EXE" },
    { name: `${familyPath}/jazz/JAZZ/JAZZ.EXE`, data: [3] },
  ]);
  const games = await openLocalLibrary(new Blob([archive]));
  assert.deepEqual(games.map((game) => game.dos.startup), [
    { kind: "command", executable: "STARCON2.COM" },
    { kind: "batch", path: "JAZZ.BAT" },
  ]);
});

test("fails closed for unknown startup recipes and corrupted DOS member checksums", async () => {
  const archive = makeArchive([
    { name: `${familyPath}/xargon/XARGON.EXE`, data: [1] },
    { name: `${familyPath}/doom/DOOM.EXE`, data: [1, 2, 3] },
  ]);
  const directoryOffset = archive.readUInt32LE(archive.length - 6);
  const entryName = Buffer.from(`${familyPath}/doom/DOOM.EXE`);
  const nameOffset = archive.indexOf(entryName, directoryOffset);
  assert.ok(nameOffset > directoryOffset);
  archive.writeUInt32LE(0, nameOffset - 30);
  archive.writeUInt32LE(0, archive.indexOf(entryName) - 16);
  const [entry] = (await openLocalLibrary(new Blob([archive]))).filter((item) => item.dos);
  assert.equal(entry.dos.title, "DOOM (Shareware v1.9)");
  await assert.rejects(entry.loadDos(), /checksum check/);
});
