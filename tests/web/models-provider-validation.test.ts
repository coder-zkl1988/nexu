import { describe, expect, it, vi } from "vitest";
import {
  requireUsableProviderModels,
  saveVerifiedProviderModels,
} from "#web/lib/provider-validation";

const messages = {
  invalid: "Credentials could not be verified",
  noModels: "No available models",
};

describe("requireUsableProviderModels", () => {
  it("rejects invalid credentials with the provider error", () => {
    expect(() =>
      requireUsableProviderModels(
        { valid: false, error: "HTTP 401" },
        messages,
      ),
    ).toThrow("HTTP 401");
  });

  it("rejects authentication success when no model is available", () => {
    expect(() =>
      requireUsableProviderModels({ valid: true, models: [] }, messages),
    ).toThrow("No available models");
  });

  it("returns normalized models only after both checks pass", () => {
    expect(
      requireUsableProviderModels(
        {
          valid: true,
          models: [
            " gpt-5 ",
            { id: "gpt-5-mini" },
            "gpt-5",
            "   ",
            { id: "  " },
            { unexpected: true },
          ],
        },
        messages,
      ),
    ).toEqual(["gpt-5", "gpt-5-mini"]);
  });

  it("does not call save when credential verification fails", async () => {
    const save = vi.fn();

    await expect(
      saveVerifiedProviderModels(
        async () => ({ valid: false, error: "HTTP 403" }),
        save,
        messages,
      ),
    ).rejects.toThrow("HTTP 403");
    expect(save).not.toHaveBeenCalled();
  });

  it("does not call save when verification returns no models", async () => {
    const save = vi.fn();

    await expect(
      saveVerifiedProviderModels(
        async () => ({ valid: true, models: [] }),
        save,
        messages,
      ),
    ).rejects.toThrow("No available models");
    expect(save).not.toHaveBeenCalled();
  });

  it("saves only after credentials and model availability pass", async () => {
    const save = vi.fn(async () => {});

    await expect(
      saveVerifiedProviderModels(
        async () => ({ valid: true, models: ["gpt-5"] }),
        save,
        messages,
      ),
    ).resolves.toEqual(["gpt-5"]);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      ["gpt-5"],
      expect.objectContaining({ valid: true }),
    );
  });
});
