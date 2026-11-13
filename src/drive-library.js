import { describeFile } from "./library.js";
import { catalogDosArchiveEntries } from "./dos-library.js";

const API_ROOT = "https://www.googleapis.com/drive/v3/files/";
const RANGE_SIZE = 2 * 1024 * 1024;
const MAX_DIRECTORY_SIZE = 16 * 1024 * 1024;
const MAX_GAME_SIZE = 64 * 1024 * 1024;
const ALLOWED_FOLDERS = new Set(["gb", "gbc", "snes", "md"]);
const SUPPORTED_METHODS = new Set([0, 8]);

export class DriveLibraryError extends Error {
  constructor(message, status = undefined) {
    super(message);
    this.name = "DriveLibraryError";
    this.status = status;
  }
}

function driveMessage(status) {
  if (status === 401) return "Google Drive authorization expired. Reconnect your account.";
  if (status === 403) return "Google Drive denied access. Reconnect or ask for access to this file.";
  if (status === 404) return "The Google Drive ZIP was not found. Check the selected file.";
  return `Google Drive returned HTTP ${status}.`;
}

function parseContentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value || "");
  if (!match) throw new DriveLibraryError("Google Drive did not return a valid byte range.");
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

function propagateSignalError(error, signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) throw error;
}

async function readResponseBytes(response, expectedSize, signal) {
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== expectedSize)) {
    await response.body?.cancel();
    throw new DriveLibraryError("Google Drive returned a byte range with an invalid length.");
  }
  if (!response.body) throw new DriveLibraryError("Google Drive returned an empty byte range.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > expectedSize) {
        await reader.cancel();
        throw new DriveLibraryError("Google Drive returned an overlong byte range.");
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof DriveLibraryError) throw error; propagateSignalError(error, signal); throw new DriveLibraryError("Google Drive returned an unreadable byte range.");
  } finally {
    reader.releaseLock();
  }
  if (size !== expectedSize) throw new DriveLibraryError("Google Drive returned a truncated byte range.");
  if (chunks.length === 1) return chunks[0];
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

function directoryEntries(bytes, totalSize) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLength === bytes.length) {
        endOffset = offset;
        break;
      }
    }
  }
  if (endOffset < 0) throw new DriveLibraryError("This file is not a supported ZIP archive.");

  const disk = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (disk || directoryDisk || diskEntries !== entryCount || entryCount === 0xffff || directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff || directoryOffset + directorySize > totalSize) {
    throw new DriveLibraryError("This ZIP uses a layout that the browser library cannot read.");
  }
  if (directorySize > MAX_DIRECTORY_SIZE) throw new DriveLibraryError("The ZIP directory is too large to read safely.");
  return { count: entryCount, offset: directoryOffset, size: directorySize };
}

function parseEntries(bytes, expectedCount) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
  const entries = [];
  let offset = 0;
  let records = 0;
  while (offset + 46 <= bytes.length && records < expectedCount) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new DriveLibraryError("The ZIP directory is malformed.");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (offset + recordLength > bytes.length) throw new DriveLibraryError("The ZIP directory is truncated.");
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replaceAll("\\", "/");
    if (!(flags & 1) && SUPPORTED_METHODS.has(method) && size > 0 && size <= MAX_GAME_SIZE && compressedSize <= MAX_GAME_SIZE && localOffset !== 0xffffffff) {
      entries.push({ name, size, compressedSize, crc, method, localOffset, nameLength, flags });
    }
    offset += recordLength;
    records += 1;
  }
  if (records !== expectedCount) throw new DriveLibraryError("The ZIP directory entry count is inconsistent.");
  return entries;
}

function safeGamePath(name) {
  const parts = name.replaceAll("\\", "/").split("/");
  if (parts.some((part) => part === ".." || part === ".") || parts.length < 3 || parts.length > 4) return false;
  const gameIndex = parts.length === 4 ? 1 : 0;
  return parts[gameIndex].toLowerCase() === "games" && ALLOWED_FOLDERS.has((parts[gameIndex + 1] || "").toLowerCase()) && Boolean(parts.at(-1)) && !parts.at(-1).endsWith("/");
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function updateCrc(crc, bytes) {
  let value = crc;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

export async function openDriveLibrary({ fileId, resourceKey, getToken, signal }) {
  if (!fileId || typeof getToken !== "function") throw new DriveLibraryError("A Drive file and access token are required.");
  if (signal?.aborted) propagateSignalError(undefined, signal);
  const url = new URL(encodeURIComponent(fileId), API_ROOT);
  url.searchParams.set("alt", "media");
  const headersFor = async (range, requestSignal) => {
    if (requestSignal?.aborted) propagateSignalError(undefined, requestSignal);
    const token = await getToken();
    if (requestSignal?.aborted) propagateSignalError(undefined, requestSignal);
    if (typeof token !== "string" || !token) throw new DriveLibraryError("Google Drive authorization is unavailable.");
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    if (range) headers.set("Range", range);
    if (resourceKey) headers.set("X-Goog-Drive-Resource-Keys", `${fileId}/${resourceKey}`);
    return headers;
  };

  const metadataUrl = new URL(encodeURIComponent(fileId), API_ROOT);
  metadataUrl.searchParams.set("fields", "size,capabilities(canDownload)");
  const metadataHeaders = await headersFor(undefined, signal);
  let metadataResponse;
  try {
    metadataResponse = await fetch(metadataUrl, { headers: metadataHeaders, signal });
  } catch (error) {
    propagateSignalError(error, signal); throw new DriveLibraryError("Could not reach Google Drive.");
  }
  if (!metadataResponse.ok) throw new DriveLibraryError(driveMessage(metadataResponse.status), metadataResponse.status);
  let metadata;
  try {
    metadata = await metadataResponse.json();
  } catch (error) {
    propagateSignalError(error, signal); throw new DriveLibraryError("Google Drive returned invalid file metadata.");
  }
  if (!metadata || typeof metadata !== "object") throw new DriveLibraryError("Google Drive returned invalid file metadata.");
  const totalSize = Number(metadata.size);
  if (!Number.isSafeInteger(totalSize) || totalSize <= 0 || metadata.capabilities?.canDownload === false) throw new DriveLibraryError("This Google Drive file is empty or cannot be downloaded.");

  async function readRange(start, endExclusive, requestSignal) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endExclusive) || start < 0 || endExclusive <= start || endExclusive > totalSize) throw new DriveLibraryError("The ZIP requested an invalid byte range.");
    const chunks = [];
    for (let position = start; position < endExclusive;) {
      const end = Math.min(position + RANGE_SIZE, endExclusive);
      const headers = await headersFor(`bytes=${position}-${end - 1}`, requestSignal);
      let response;
      try {
        response = await fetch(url, { headers, signal: requestSignal });
      } catch (error) {
        propagateSignalError(error, requestSignal); throw new DriveLibraryError("Could not reach Google Drive.");
      }
      if (response.status !== 206) { await response.body?.cancel(); throw new DriveLibraryError(driveMessage(response.status), response.status); }
      const contentRange = response.headers.get("Content-Range");
      if (contentRange) {
        try {
          const range = parseContentRange(contentRange);
          if (range.start !== position || range.end !== end - 1 || range.total !== totalSize) {
            throw new DriveLibraryError("Google Drive returned an incomplete or inconsistent byte range.");
          }
        } catch (error) {
          await response.body?.cancel(); throw error;
        }
      }
      const body = await readResponseBytes(response, end - position, requestSignal);
      chunks.push(body);
      position = end;
    }
    if (chunks.length === 1) return chunks[0];
    return new Uint8Array(await new Blob(chunks).arrayBuffer());
  }

  return openArchive(totalSize, readRange, signal);
}

export async function openLocalLibrary(file, signal) {
  if (!(file instanceof Blob) || !Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new DriveLibraryError("Choose a non-empty local ZIP archive.");
  }
  if (signal?.aborted) propagateSignalError(undefined, signal);
  const totalSize = file.size;
  async function readRange(start, endExclusive, requestSignal) {
    if (requestSignal?.aborted) propagateSignalError(undefined, requestSignal);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endExclusive) || start < 0 || endExclusive <= start || endExclusive > totalSize) {
      throw new DriveLibraryError("The ZIP requested an invalid byte range.");
    }
    const chunks = [];
    for (let position = start; position < endExclusive;) {
      if (requestSignal?.aborted) propagateSignalError(undefined, requestSignal);
      const end = Math.min(position + RANGE_SIZE, endExclusive);
      try {
        chunks.push(new Uint8Array(await file.slice(position, end).arrayBuffer()));
      } catch (error) {
        propagateSignalError(error, requestSignal);
        throw new DriveLibraryError("The ZIP could not be read. Make sure it’s available on this device, then try again.");
      }
      position = end;
    }
    if (requestSignal?.aborted) propagateSignalError(undefined, requestSignal);
    if (chunks.length === 1) return chunks[0];
    return new Uint8Array(await new Blob(chunks).arrayBuffer());
  }
  return openArchive(totalSize, readRange, signal);
}

async function openArchive(totalSize, readRange, signal) {
  const tailStart = Math.max(0, totalSize - 65_557);
  const tail = await readRange(tailStart, totalSize, signal);
  const directory = directoryEntries(tail, totalSize);
  if (directory.count === 0) return [];
  const rawDirectory = await readRange(directory.offset, directory.offset + directory.size, signal);
  const archiveEntries = parseEntries(rawDirectory, directory.count);
  const candidates = archiveEntries
    .filter((entry) => safeGamePath(entry.name))
    .filter((entry) => {
      try {
        describeFile({ name: entry.name.split("/").at(-1), size: entry.size, webkitRelativePath: entry.name });
        return true;
      } catch {
        return false;
      }
    });

  const cartridgeEntries = candidates.map((entry) => {
    const name = entry.name.split("/").at(-1);
    return {
      name,
      size: entry.size,
      webkitRelativePath: entry.name,
      async load(loadSignal) {
        const requestSignal = loadSignal;
        if (requestSignal?.aborted) propagateSignalError(undefined, requestSignal);
        if (entry.localOffset + 30 > totalSize) throw new DriveLibraryError("The ZIP entry header is outside the archive.");
        const local = await readRange(entry.localOffset, entry.localOffset + 30, requestSignal);
        const localView = new DataView(local.buffer, local.byteOffset, local.byteLength);
        if (localView.getUint32(0, true) !== 0x04034b50) throw new DriveLibraryError("The ZIP entry header is malformed.");
        const dataStart = entry.localOffset + 30 + localView.getUint16(26, true) + localView.getUint16(28, true);
        if (dataStart > totalSize || entry.compressedSize > totalSize - dataStart) throw new DriveLibraryError("The ZIP entry data is outside the archive.");
        const compressed = await readRange(dataStart, dataStart + entry.compressedSize, requestSignal);
        const source = new Blob([compressed]);
        const output = entry.method === 0 ? source.stream() : source.stream().pipeThrough(new DecompressionStream("deflate-raw"));
        const reader = output.getReader();
        const outputChunks = [];
        let size = 0;
        let crc = 0xffffffff;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > entry.size || size > MAX_GAME_SIZE) throw new DriveLibraryError("The ZIP entry expanded beyond its declared size.");
            crc = updateCrc(crc, part.value);
            outputChunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        if (size !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) {
          throw new DriveLibraryError("The ZIP entry failed its size or checksum check.");
        }
        return new Blob(outputChunks);
      },
    };
  });
  const dosEntries = catalogDosArchiveEntries(
    archiveEntries.filter((entry) => !(entry.flags & 1) && SUPPORTED_METHODS.has(entry.method) && entry.localOffset !== 0xffffffff),
    (files, loadSignal) => loadDosArchiveFiles(files, totalSize, readRange, loadSignal),
  );
  return [...cartridgeEntries, ...dosEntries];
}

const MAX_DOS_GAME_SIZE = 64 * 1024 * 1024;
const MAX_DOS_FETCHES_IN_FLIGHT = 6;
const MAX_DOS_RANGE_GAP = 64 * 1024;
const MAX_DOS_COMPRESSED_RANGE_BYTES = 96 * 1024 * 1024;

async function loadDosArchiveFiles(files, totalSize, readRange, signal) {
  if (signal?.aborted) propagateSignalError(undefined, signal);
  const boundedFiles = files.filter((entry) => Number.isSafeInteger(entry.localOffset) && entry.localOffset >= 0 &&
    Number.isSafeInteger(entry.compressedSize) && entry.compressedSize > 0 && entry.compressedSize <= MAX_DOS_GAME_SIZE &&
    Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= MAX_DOS_GAME_SIZE);
  const declaredSize = boundedFiles.reduce((sum, entry) => sum + entry.size, 0);
  const declaredCompressedSize = boundedFiles.reduce((sum, entry) => sum + entry.compressedSize, 0);
  if (boundedFiles.length !== files.length || !boundedFiles.length || boundedFiles.length > 512 ||
      declaredSize > MAX_DOS_GAME_SIZE || declaredCompressedSize > MAX_DOS_GAME_SIZE) {
    throw new DriveLibraryError("The DOS game exceeds safe extraction limits.");
  }
  const rangeController = new AbortController();
  const abortPendingRanges = () => rangeController.abort(signal?.reason);
  if (signal?.aborted) abortPendingRanges();
  else signal?.addEventListener("abort", abortPendingRanges, { once: true });
  const rangeSignal = rangeController.signal;
  const decoder = new TextDecoder("utf-8");
  const localEntries = new Array(boundedFiles.length);
  let nextHeader = 0;
  const readHeaders = Array.from({ length: Math.min(MAX_DOS_FETCHES_IN_FLIGHT, boundedFiles.length) }, async () => {
    while (true) {
      if (rangeSignal.aborted) propagateSignalError(undefined, rangeSignal);
      const index = nextHeader++;
      if (index >= boundedFiles.length) return;
      const entry = boundedFiles[index];
      if (entry.localOffset + 30 + entry.nameLength > totalSize) throw new DriveLibraryError("A DOS game ZIP header is outside the archive.");
      const header = await readRange(entry.localOffset, entry.localOffset + 30 + entry.nameLength, rangeSignal);
      const view = new DataView(header.buffer, header.byteOffset, 30);
      if (view.getUint32(0, true) !== 0x04034b50) throw new DriveLibraryError("A DOS game ZIP entry header is malformed.");
      const flags = view.getUint16(6, true);
      const method = view.getUint16(8, true);
      const localCrc = view.getUint32(14, true);
      const localCompressedSize = view.getUint32(18, true);
      const localSize = view.getUint32(22, true);
      const localNameLength = view.getUint16(26, true);
      const localExtraLength = view.getUint16(28, true);
      if ((flags & 1) || method !== entry.method || localNameLength !== entry.nameLength ||
          decoder.decode(header.subarray(30)).replaceAll("\\", "/") !== entry.name ||
          (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize) ||
          (localSize !== 0 && localSize !== entry.size) || (localCrc !== 0 && localCrc !== entry.crc)) {
        throw new DriveLibraryError("A DOS game ZIP entry header does not match its directory record.");
      }
      const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + entry.compressedSize;
      if (!Number.isSafeInteger(dataEnd) || dataEnd > totalSize) throw new DriveLibraryError("A DOS game ZIP entry data is outside the archive.");
      localEntries[index] = { entry, dataStart, dataEnd };
    }
  });
  try {
    await Promise.all(readHeaders);

    const sortedExtents = localEntries.slice().sort((left, right) => left.dataStart - right.dataStart);
    const ranges = [];
    for (const extent of sortedExtents) {
      let range = ranges.at(-1);
      if (!range || extent.dataStart - range.end > MAX_DOS_RANGE_GAP || extent.dataEnd - range.start > MAX_DOS_GAME_SIZE) {
        range = { start: extent.dataStart, end: extent.dataEnd, extents: [] };
        ranges.push(range);
      } else {
        range.end = Math.max(range.end, extent.dataEnd);
      }
      range.extents.push(extent);
    }
    if (ranges.reduce((sum, range) => sum + range.end - range.start, 0) > MAX_DOS_COMPRESSED_RANGE_BYTES) {
      throw new DriveLibraryError("The DOS game ZIP ranges exceed safe download limits.");
    }
    let nextRange = 0;
    const readRanges = Array.from({ length: Math.min(MAX_DOS_FETCHES_IN_FLIGHT, ranges.length) }, async () => {
      while (true) {
        if (rangeSignal.aborted) propagateSignalError(undefined, rangeSignal);
        const index = nextRange++;
        if (index >= ranges.length) return;
        const range = ranges[index];
        if (range.end <= range.start || range.end - range.start > MAX_DOS_GAME_SIZE) throw new DriveLibraryError("The DOS game ZIP layout exceeds safe extraction limits.");
        range.bytes = await readRange(range.start, range.end, rangeSignal);
      }
    });
    await Promise.all(readRanges);
    for (const range of ranges) {
      for (const extent of range.extents) {
        const start = extent.dataStart - range.start;
        extent.compressed = range.bytes.subarray(start, start + extent.entry.compressedSize);
      }
    }
  } catch (error) {
    rangeController.abort(error);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortPendingRanges);
  }

  const result = [];
  let total = 0;
  for (const { entry, compressed } of localEntries) {
    if (signal?.aborted) propagateSignalError(undefined, signal);
    const source = new Blob([compressed]);
    let output;
    try {
      output = entry.method === 0 ? source.stream() : source.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    } catch {
      throw new DriveLibraryError("This browser cannot safely decompress the selected DOS game.");
    }
    const reader = output.getReader();
    const chunks = [];
    let size = 0;
    let crc = 0xffffffff;
    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          propagateSignalError(undefined, signal);
        }
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        total += part.value.byteLength;
        if (size > entry.size || size > MAX_DOS_GAME_SIZE || total > MAX_DOS_GAME_SIZE) {
          await reader.cancel();
          throw new DriveLibraryError("The DOS game expanded beyond its declared size.");
        }
        crc = updateCrc(crc, part.value);
        chunks.push(part.value);
      }
    } catch (error) {
      if (error instanceof DriveLibraryError) throw error;
      propagateSignalError(error, signal);
      throw new DriveLibraryError("The DOS game ZIP entry could not be decompressed.");
    } finally {
      reader.releaseLock();
    }
    if (size !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) {
      throw new DriveLibraryError("The DOS game ZIP entry failed its size or checksum check.");
    }
    result.push({ path: entry.path, bytes: new Uint8Array(await new Blob(chunks).arrayBuffer()) });
  }
  return result;
}
