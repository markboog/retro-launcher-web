import test from "node:test";
import assert from "node:assert/strict";
import { libraryFileIdForLaunch } from "../src/drive-auth.js";

const familyId = "configuredFamilyLibraryId123";
const overrideId = "explicitAlternateLibraryId123";

test("the plain launcher URL targets the configured family ZIP", () => {
  assert.equal(libraryFileIdForLaunch("", familyId), familyId);
  assert.equal(libraryFileIdForLaunch("#library=wrong%2Cfile", familyId), familyId);
});

test("an explicit library link overrides the default, and self-hosted builds can omit it", () => {
  assert.equal(libraryFileIdForLaunch(`#library=${overrideId}`, familyId), overrideId);
  assert.equal(libraryFileIdForLaunch(`#library=${overrideId}`, ""), overrideId);
  assert.equal(libraryFileIdForLaunch("", ""), null);
  assert.equal(libraryFileIdForLaunch("", "malformed,default"), null);
});
