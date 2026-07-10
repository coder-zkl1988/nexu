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

  it("split kind round-trips through open/close", () => {
    openCanvasDialog({ kind: "split", nodeId: "split-node-1" });
    expect(getCanvasDialog()).toEqual({
      kind: "split",
      nodeId: "split-node-1",
    });
    closeCanvasDialog();
    expect(getCanvasDialog()).toBeNull();
  });

  it("upscale kind round-trips through open/close", () => {
    openCanvasDialog({ kind: "upscale", nodeId: "upscale-node-1" });
    expect(getCanvasDialog()).toEqual({
      kind: "upscale",
      nodeId: "upscale-node-1",
    });
    closeCanvasDialog();
    expect(getCanvasDialog()).toBeNull();
  });

  it("split open overwrites crop open", () => {
    openCanvasDialog({ kind: "crop", nodeId: "crop-1" });
    openCanvasDialog({ kind: "split", nodeId: "split-1" });
    expect(getCanvasDialog()).toEqual({ kind: "split", nodeId: "split-1" });
  });

  it("upscale open overwrites split open", () => {
    openCanvasDialog({ kind: "split", nodeId: "split-1" });
    openCanvasDialog({ kind: "upscale", nodeId: "upscale-1" });
    expect(getCanvasDialog()).toEqual({ kind: "upscale", nodeId: "upscale-1" });
  });

  it("mask kind round-trips through open/close", () => {
    openCanvasDialog({ kind: "mask", nodeId: "mask-node-1" });
    expect(getCanvasDialog()).toEqual({ kind: "mask", nodeId: "mask-node-1" });
    closeCanvasDialog();
    expect(getCanvasDialog()).toBeNull();
  });

  it("angle kind round-trips through open/close", () => {
    openCanvasDialog({ kind: "angle", nodeId: "angle-node-1" });
    expect(getCanvasDialog()).toEqual({
      kind: "angle",
      nodeId: "angle-node-1",
    });
    closeCanvasDialog();
    expect(getCanvasDialog()).toBeNull();
  });

  it("mask open overwrites upscale open", () => {
    openCanvasDialog({ kind: "upscale", nodeId: "upscale-1" });
    openCanvasDialog({ kind: "mask", nodeId: "mask-1" });
    expect(getCanvasDialog()).toEqual({ kind: "mask", nodeId: "mask-1" });
  });

  it("angle open overwrites mask open", () => {
    openCanvasDialog({ kind: "mask", nodeId: "mask-1" });
    openCanvasDialog({ kind: "angle", nodeId: "angle-1" });
    expect(getCanvasDialog()).toEqual({ kind: "angle", nodeId: "angle-1" });
  });

  it("nodeId-less assets kind round-trips through open/close", () => {
    openCanvasDialog({ kind: "assets" });
    expect(getCanvasDialog()).toEqual({ kind: "assets" });
    closeCanvasDialog();
    expect(getCanvasDialog()).toBeNull();
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
