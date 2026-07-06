import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetCanvasDialogsForTests,
  __subscribeForTests,
  closeCanvasDialog,
  getCanvasDialog,
  openCanvasDialog,
} from "../src/lib/canvas/canvas-dialogs";

afterEach(() => {
  __resetCanvasDialogsForTests();
});

describe("canvas-dialogs module store", () => {
  it("initial state is null", () => {
    expect(getCanvasDialog()).toBeNull();
  });

  it("openCanvasDialog sets state", () => {
    openCanvasDialog({ kind: "crop", nodeId: "node-1" });
    expect(getCanvasDialog()).toEqual({ kind: "crop", nodeId: "node-1" });
  });

  it("closeCanvasDialog resets to null", () => {
    openCanvasDialog({ kind: "crop", nodeId: "node-1" });
    closeCanvasDialog();
    expect(getCanvasDialog()).toBeNull();
  });

  it("reset helper clears state", () => {
    openCanvasDialog({ kind: "crop", nodeId: "node-2" });
    __resetCanvasDialogsForTests();
    expect(getCanvasDialog()).toBeNull();
  });

  it("multiple opens overwrite each other", () => {
    openCanvasDialog({ kind: "crop", nodeId: "node-1" });
    openCanvasDialog({ kind: "crop", nodeId: "node-2" });
    expect(getCanvasDialog()).toEqual({ kind: "crop", nodeId: "node-2" });
  });

  it("subscription mechanism: spy is called on open and close, not after unsubscribe", () => {
    const spy = vi.fn();
    const unsubscribe = __subscribeForTests(spy);

    // open → spy fires, state is set
    openCanvasDialog({ kind: "crop", nodeId: "sub-node" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getCanvasDialog()).toEqual({ kind: "crop", nodeId: "sub-node" });

    // close → spy fires again, state is null
    closeCanvasDialog();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(getCanvasDialog()).toBeNull();

    // unsubscribe → further opens do not call spy
    unsubscribe();
    openCanvasDialog({ kind: "crop", nodeId: "sub-node-2" });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
