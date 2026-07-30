import { describe, expect, it } from "vitest";
import { BrowserRefTable } from "../../apps/desktop/main/services/embedded-browser-cdp";

// Refs are what let an agent act on an element and then prove the action
// landed by reading the same element back. Both properties below are load
// bearing: stability makes the read-back possible, invalidation stops a ref
// from silently retargeting after the page changes underneath it.

describe("BrowserRefTable", () => {
  it("gives one node the same ref across snapshots", () => {
    const refs = new BrowserRefTable();

    const first = refs.add(42);
    const second = refs.add(42);

    // Renumbering per snapshot would mean "type into e12, snapshot, check e12"
    // silently checks a different element.
    expect(second).toBe(first);
    expect(refs.resolve(first)).toBe(42);
  });

  it("gives distinct nodes distinct refs", () => {
    const refs = new BrowserRefTable();

    const a = refs.add(1);
    const b = refs.add(2);

    expect(a).not.toBe(b);
    expect(refs.resolve(a)).toBe(1);
    expect(refs.resolve(b)).toBe(2);
  });

  it("drops every ref on reset so a stale ref cannot retarget", () => {
    const refs = new BrowserRefTable();
    const ref = refs.add(7);

    refs.reset();

    // A backend node id from the previous page could be reused by the new one.
    // Resolving to null forces the agent to snapshot again.
    expect(refs.resolve(ref)).toBeNull();
  });

  it("never reissues a ref id across a reset", () => {
    const refs = new BrowserRefTable();
    const before = refs.add(11);
    refs.add(22);

    refs.reset();
    const fresh = refs.add(99);

    // Restarting the numbering would hand the new page the old page's ids: a
    // conversation still holding "e1" from before the navigation would click
    // whatever the new page put at "e1" — an element its agent never saw.
    // Continuing the sequence turns that stale ref into a clean unknown.
    expect(fresh).toBe("e3");
    expect(refs.resolve(before)).toBeNull();
    expect(refs.resolve(fresh)).toBe(99);
  });

  it("reports unknown refs as null rather than guessing", () => {
    const refs = new BrowserRefTable();
    refs.add(5);

    expect(refs.resolve("e999")).toBeNull();
    expect(refs.resolve("")).toBeNull();
    expect(refs.resolve("../../etc")).toBeNull();
  });
});
