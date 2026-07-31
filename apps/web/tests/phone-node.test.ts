import { describe, expect, it } from "vitest";
import {
  mapPhonePointerToDevice,
  phoneNodeHeightForScreen,
} from "../src/lib/canvas/phone-node";

describe("phoneNodeHeightForScreen", () => {
  it("fits the node to the phone screenshot ratio plus the device picker", () => {
    expect(phoneNodeHeightForScreen(300, 1080, 2400)).toBe(721);
    expect(phoneNodeHeightForScreen(270, 1080, 1920)).toBe(534);
  });

  it("rejects invalid dimensions", () => {
    expect(phoneNodeHeightForScreen(0, 1080, 2400)).toBeNull();
    expect(phoneNodeHeightForScreen(300, 0, 2400)).toBeNull();
    expect(phoneNodeHeightForScreen(300, 1080, 0)).toBeNull();
  });
});

describe("mapPhonePointerToDevice", () => {
  it("maps the rendered screenshot center to the physical screen center", () => {
    expect(
      mapPhonePointerToDevice(
        160,
        270,
        { left: 10, top: 20, width: 300, height: 500 },
        1080,
        1920,
        1080,
        2400,
      ),
    ).toEqual({ x: 540, y: 1200 });
  });

  it("ignores clicks in object-contain letterboxing", () => {
    expect(
      mapPhonePointerToDevice(
        5,
        250,
        { left: 0, top: 0, width: 300, height: 500 },
        1080,
        1920,
        1080,
        2400,
      ),
    ).toBeNull();
  });

  it("rejects invalid geometry", () => {
    expect(
      mapPhonePointerToDevice(
        0,
        0,
        { left: 0, top: 0, width: 0, height: 500 },
        1080,
        1920,
        1080,
        2400,
      ),
    ).toBeNull();
  });
});
