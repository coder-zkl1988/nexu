import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LowDbStore } from "../src/store/lowdb-store.js";

// Falling back to defaults overwrites the file on disk. When the file existed
// and merely failed to parse, that destroys real user data — and the backup is
// overwritten on the very next write, so nothing survives. A quarantine copy is
// the only thing standing between a schema mistake and an unrecoverable wipe.

const schema = z.object({ items: z.array(z.string()).default([]) });
const createDefault = () => ({ items: [] as string[] });

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lowdb-"));
  return path.join(dir, "config.json");
}

describe("LowDbStore recovery", () => {
  it("keeps a copy of a config it could not parse", async () => {
    const file = await tempFile();
    await writeFile(file, JSON.stringify({ items: [1, 2, 3] }), "utf8");

    const store = new LowDbStore(file, schema, createDefault);
    const value = await store.read();

    // The reset itself still happens — the app has to start.
    expect(value.items).toEqual([]);

    const siblings = await readdir(path.dirname(file));
    const quarantined = siblings.filter((name) => name.includes(".corrupt-"));
    expect(quarantined).toHaveLength(1);

    const preserved = JSON.parse(
      await readFile(
        path.join(path.dirname(file), quarantined[0] as string),
        "utf8",
      ),
    );
    expect(preserved).toEqual({ items: [1, 2, 3] });
  });

  it("prefers the backup over resetting", async () => {
    const file = await tempFile();
    await writeFile(file, "{ not json", "utf8");
    await writeFile(`${file}.bak`, JSON.stringify({ items: ["kept"] }), "utf8");

    const store = new LowDbStore(file, schema, createDefault);

    expect((await store.read()).items).toEqual(["kept"]);
    const siblings = await readdir(path.dirname(file));
    expect(siblings.filter((n) => n.includes(".corrupt-"))).toHaveLength(0);
  });

  it("does not quarantine when there was simply no file yet", async () => {
    const file = await tempFile();

    const store = new LowDbStore(file, schema, createDefault);
    expect((await store.read()).items).toEqual([]);

    // First run is not a data-loss event and must not look like one.
    const siblings = await readdir(path.dirname(file));
    expect(siblings.filter((n) => n.includes(".corrupt-"))).toHaveLength(0);
  });
});
