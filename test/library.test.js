import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeFile } from "../src/library.js";

test("identifies unambiguous cartridge formats", () => {
  assert.equal(describeFile({ name: "Orbit.GB", size: 32768 }).system, "gb");
  assert.equal(describeFile({ name: "Adventures.gbc", size: 32768 }).system, "gbc");
  assert.equal(describeFile({ name: "Adventures.smc", size: 32768 }).system, "snes");
  assert.equal(describeFile({ name: "Adventures.gen", size: 32768 }).system, "segaMD");
});

test("uses the recognized platform folder for archive and binary imports", () => {
  const zip = { name: "Game (U) [!].zip", size: 9, webkitRelativePath: "games/snes/Game (U) [!].zip" };
  assert.equal(describeFile(zip).system, "snes");
  assert.equal(describeFile(zip).title, "Game");
  const bin = { name: "014. Game.bin", size: 9, webkitRelativePath: "games/md/014. Game.bin" };
  assert.equal(describeFile(bin).system, "segaMD");
  assert.equal(describeFile(bin).title, "Game");
});

test("requires a system for an ambiguous file and rejects unsupported or oversized files", () => {
  const zip = { name: "Game.zip", size: 9 };
  assert.throws(() => describeFile(zip), /Choose a system/);
  assert.equal(describeFile(zip, "gb").system, "gb");
  assert.throws(() => describeFile({ name: "Game.exe", size: 9 }, "gb"), /unsupported/i);
  assert.throws(() => describeFile({ name: "Library.zip", size: 1_090_438_599 }, "snes"), /64 MB/);
});
