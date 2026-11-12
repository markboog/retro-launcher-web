import { deflateRawSync } from "node:zlib";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DriveLibraryError, openDriveLibrary, openLocalLibrary } from "../src/drive-library.js";

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
    const compressed = item.method === 8 ? deflateRawSync(raw) : raw;
    const checksum = crc32(raw);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(item.method, 8);
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
    central.writeUInt16LE(item.method, 10);
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

function mockDrive(archive, {
  omitContentRange = false,
  rangeStatus = 206,
  metadataStatus = 200,
  overlongRange = false,
} = {}) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    requests.push({ url, headers });
    if (url.searchParams.has("fields")) {
      if (metadataStatus !== 200) return new Response(null, { status: metadataStatus });
      return Response.json({ size: String(archive.length), capabilities: { canDownload: true } });
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(headers.get("Range") || "");
    assert.ok(match, "media requests must include a byte range");
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (rangeStatus !== 206) return new Response(archive, { status: rangeStatus });
    const requested = archive.subarray(start, end + 1);
    const body = overlongRange ? Buffer.concat([requested, Buffer.from([255])]) : requested;
    const responseHeaders = { "Content-Length": String(body.length) };
    if (overlongRange) responseHeaders["Content-Length"] = String(requested.length);
    if (!omitContentRange) responseHeaders["Content-Range"] = `bytes ${start}-${end}/${archive.length}`;
    return new Response(body, { status: 206, headers: responseHeaders });
  };
  return { requests, restore: () => { globalThis.fetch = originalFetch; } };
}

test("lists and loads stored and deflated games through bounded Drive byte ranges", async () => {
  const payload = Buffer.from([1, 2, 3, 4, 5]);
  const archive = makeArchive([
    { name: "RetroLauncher\\games\\gb\\one.gb", data: payload, method: 0 },
    { name: "RetroLauncher/games/md/two.zip", data: payload, method: 8 },
    { name: "RetroLauncher/games/psx/ignored.bin", data: payload, method: 0 },
    { name: "elsewhere/ignored.gb", data: payload, method: 0 },
  ]);
  const mock = mockDrive(archive, { omitContentRange: true });
  try {
    const files = await openDriveLibrary({
      fileId: "synthetic-fixture",
      resourceKey: "synthetic-key",
      getToken: async () => "synthetic-token",
    });
    assert.deepEqual(files.map(({ webkitRelativePath }) => webkitRelativePath), [
      "RetroLauncher/games/gb/one.gb",
      "RetroLauncher/games/md/two.zip",
    ]);
    for (const file of files) assert.deepEqual(Buffer.from(await (await file.load()).arrayBuffer()), payload);
    const media = mock.requests.filter(({ url }) => url.searchParams.has("alt"));
    assert.ok(media.length >= 4);
    assert.ok(media.every(({ headers }) => headers.get("Authorization") === "Bearer synthetic-token"));
    assert.ok(media.every(({ headers }) => headers.get("X-Goog-Drive-Resource-Keys") === "synthetic-fixture/synthetic-key"));
    assert.ok(media.every(({ headers }) => headers.has("Range")));
  } finally {
    mock.restore();
  }
});

test("opens and loads supported games from a local ZIP without network access", async () => {
  const payload = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
  const archive = makeArchive([
    { name: "RetroLauncher/games/gb/local.gb", data: payload, method: 0 },
    { name: "RetroLauncher/games/snes/local.sfc", data: payload, method: 8 },
  ]);
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; throw new Error("unexpected network request"); };
  try {
    const reads = [];
    const file = new Blob([archive]);
    const slice = file.slice.bind(file);
    file.slice = (start, end, type) => {
      reads.push([start, end]);
      return slice(start, end, type);
    };
    const entries = await openLocalLibrary(file);
    assert.deepEqual(entries.map(({ name, size, webkitRelativePath }) => ({ name, size, webkitRelativePath })), [
      { name: "local.gb", size: payload.length, webkitRelativePath: "RetroLauncher/games/gb/local.gb" },
      { name: "local.sfc", size: payload.length, webkitRelativePath: "RetroLauncher/games/snes/local.sfc" },
    ]);
    for (const entry of entries) assert.deepEqual(Buffer.from(await (await entry.load()).arrayBuffer()), payload);
    assert.ok(reads.every(([start, end]) => end - start <= 2 * 1024 * 1024));
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validates Content-Range when the browser exposes it", async () => {
  const archive = makeArchive([{ name: "games/gb/one.gb", data: [1], method: 0 }]);
  const mock = mockDrive(archive);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const url = new URL(input);
    if (url.searchParams.has("fields")) return response;
    return new Response(await response.arrayBuffer(), {
      status: 206,
      headers: { "Content-Range": `bytes 1-1/${archive.length}`, "Content-Length": "1" },
    });
  };
  try {
    await assert.rejects(openDriveLibrary({ fileId: "synthetic", getToken: async () => "token" }),
      (error) => error instanceof DriveLibraryError && /inconsistent byte range/.test(error.message));
  } finally {
    globalThis.fetch = originalFetch;
    mock.restore();
  }
});

test("rejects a full-file response instead of falling back from range reading", async () => {
  const archive = makeArchive([{ name: "games/gb/one.gb", data: [1], method: 0 }]);
  const mock = mockDrive(archive, { rangeStatus: 200 });
  try {
    await assert.rejects(openDriveLibrary({ fileId: "synthetic", getToken: async () => "token" }),
      (error) => error instanceof DriveLibraryError && error.status === 200);
  } finally {
    mock.restore();
  }
});

test("preserves Drive permission status for reconnect and sharing flows", async () => {
  const archive = makeArchive([{ name: "games/gb/one.gb", data: [1], method: 0 }]);
  const mock = mockDrive(archive, { metadataStatus: 403 });
  try {
    await assert.rejects(openDriveLibrary({ fileId: "synthetic", getToken: async () => "token" }),
      (error) => error instanceof DriveLibraryError && error.status === 403 && /denied access/.test(error.message));
    assert.equal(mock.requests.filter(({ url }) => url.searchParams.has("alt")).length, 0);
  } finally {
    mock.restore();
  }
});

test("rejects an overlong streamed range even when Content-Length claims the requested size", async () => {
  const archive = makeArchive([{ name: "games/gb/one.gb", data: [1], method: 0 }]);
  const mock = mockDrive(archive, { overlongRange: true });
  try {
    await assert.rejects(openDriveLibrary({ fileId: "synthetic", getToken: async () => "token" }),
      /overlong byte range/);
  } finally {
    mock.restore();
  }
});

test("preserves token expiry errors before any Drive request", async () => {
  const archive = makeArchive([]);
  const mock = mockDrive(archive);
  const expiry = Object.assign(new Error("authorization expired"), { status: 401 });
  try {
    await assert.rejects(openDriveLibrary({ fileId: "synthetic", getToken: async () => { throw expiry; } }),
      (error) => error === expiry && error.status === 401);
    assert.equal(mock.requests.length, 0);
  } finally {
    mock.restore();
  }
});

test("returns an empty list for a valid empty ZIP", async () => {
  const archive = makeArchive([]);
  const mock = mockDrive(archive);
  try {
    assert.deepEqual(await openDriveLibrary({ fileId: "synthetic", getToken: async () => "token" }), []);
  } finally {
    mock.restore();
  }
});

test("propagates timeout signals during open and later entry loading", async () => {
  const archive = makeArchive([{ name: "games/gb/one.gb", data: [1], method: 0 }]);
  const mock = mockDrive(archive);
  const timeout = new DOMException("Timed out", "TimeoutError");
  const controller = new AbortController();
  controller.abort(timeout);
  try {
    await assert.rejects(openDriveLibrary({ fileId: "synthetic", getToken: async () => "token", signal: controller.signal }),
      (error) => error === timeout);
    const files = await openDriveLibrary({ fileId: "synthetic", getToken: async () => "token" });
    await assert.rejects(files[0].load(controller.signal), (error) => error === timeout);
  } finally {
    mock.restore();
  }
});

test("rejects an entry whose uncompressed CRC does not match its directory record", async () => {
  const archive = makeArchive([{ name: "games/gb/one.gb", data: [1, 2, 3], method: 0 }]);
  const directoryOffset = archive.readUInt32LE(archive.length - 6);
  archive.writeUInt32LE(0, directoryOffset + 16);
  const mock = mockDrive(archive);
  try {
    const files = await openDriveLibrary({ fileId: "synthetic", getToken: async () => "token" });
    await assert.rejects(files[0].load(), /checksum check/);
  } finally {
    mock.restore();
  }
});
