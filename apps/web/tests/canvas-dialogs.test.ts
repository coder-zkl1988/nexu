import { afterEach, describe, expect, it } from "vitest";
import {
  __resetCanvasDialogsForTests,
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
});
