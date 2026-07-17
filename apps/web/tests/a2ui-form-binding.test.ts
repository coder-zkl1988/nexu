import { describe, expect, it } from "vitest";
import {
  createSurfaceManager,
  getBindingPath,
  getByJsonPointer,
  setByJsonPointer,
} from "../src/lib/a2ui/a2ui-surface";
import type { A2UIMessage } from "../src/lib/a2ui/a2ui-types";

describe("a2ui form binding", () => {
  it("setByJsonPointer writes nested paths and getByJsonPointer reads them back", () => {
    const model: Record<string, unknown> = {};
    setByJsonPointer(model, "/form/targetDevice", "both");
    expect(getByJsonPointer(model, "/form/targetDevice")).toBe("both");

    setByJsonPointer(model, "/form/targetDevice", "device-a");
    expect(getByJsonPointer(model, "/form/targetDevice")).toBe("device-a");
  });

  it("getBindingPath extracts path bindings and rejects literals", () => {
    expect(getBindingPath({ path: "/target" })).toBe("/target");
    expect(getBindingPath("literal")).toBeNull();
    expect(getBindingPath(42)).toBeNull();
    expect(getBindingPath(null)).toBeNull();
    expect(getBindingPath({ function: "now" })).toBeNull();
  });

  it("user form input written to the data model resolves through action context bindings", () => {
    const manager = createSurfaceManager();
    const messages: A2UIMessage[] = [
      {
        version: "v0.9",
        createSurface: { surfaceId: "s1" },
      } as unknown as A2UIMessage,
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "s1",
          path: "/target",
          // Agent-provided default — the bug: this was ALL the bot ever saw.
          value: "device-a",
        },
      } as unknown as A2UIMessage,
    ];
    manager.processMessages(messages);
    const surface = manager.getSurface("s1");
    expect(surface).toBeDefined();
    if (!surface) return;

    // Simulate the ChoicePicker writing the user's selection ("both") into
    // the bound path, then a Button resolving its action context binding.
    setByJsonPointer(surface.dataModel, "/target", "both");
    const resolved = manager.resolveValue(
      { path: "/target" },
      surface.dataModel,
    );
    expect(resolved).toBe("both");
  });

  it("component-id fallback path keeps unbound picker values addressable", () => {
    const model: Record<string, unknown> = {};
    // ChoicePicker with no explicit path/binding falls back to /<componentId>.
    setByJsonPointer(model, "/device_picker", "both");
    expect(getByJsonPointer(model, "/device_picker")).toBe("both");
  });
});
