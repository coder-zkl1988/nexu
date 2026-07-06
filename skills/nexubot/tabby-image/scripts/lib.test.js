import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  parseImageResponse,
  readImageCreditState,
  readOpenclawConfig,
  resolveLinkCredential,
  resolveOutputPath,
} from "./lib.js";

test("readOpenclawConfig throws ENV_MISSING when stateDir is falsy", () => {
  assert.throws(() => readOpenclawConfig(undefined), /ENV_MISSING/);
});

test("readOpenclawConfig throws CONFIG_MISSING when the file does not exist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  assert.throws(() => readOpenclawConfig(dir), /CONFIG_MISSING/);
});

test("readOpenclawConfig throws CONFIG_INVALID on unparsable JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  fs.writeFileSync(path.join(dir, "openclaw.json"), "{not json");
  assert.throws(() => readOpenclawConfig(dir), /CONFIG_INVALID/);
});

test("readOpenclawConfig parses a valid config file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  fs.writeFileSync(
    path.join(dir, "openclaw.json"),
    JSON.stringify({ foo: "bar" }),
  );
  const config = readOpenclawConfig(dir);
  assert.equal(config.foo, "bar");
});

test("resolveLinkCredential throws NOT_LOGGED_IN when the link provider is missing", () => {
  assert.throws(() => resolveLinkCredential({}), /NOT_LOGGED_IN/);
});

test("resolveLinkCredential throws NOT_LOGGED_IN when apiKey is empty", () => {
  const config = {
    models: {
      providers: { link: { baseUrl: "https://x/v1", apiKey: "", models: [] } },
    },
  };
  assert.throws(() => resolveLinkCredential(config), /NOT_LOGGED_IN/);
});

test("resolveLinkCredential throws NO_IMAGE_MODEL when neither variant is present", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "gpt-5.5" }, { id: "deepseek-v4-pro" }],
        },
      },
    },
  };
  assert.throws(() => resolveLinkCredential(config), /NO_IMAGE_MODEL/);
});

test("resolveLinkCredential prefers tabby-image over tabby-image-free", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image-free" }, { id: "tabby-image" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config);
  assert.equal(result.model, "tabby-image");
  assert.equal(result.baseUrl, "https://x/v1");
  assert.equal(result.apiKey, "key123");
});

test("resolveLinkCredential falls back to tabby-image-free", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image-free" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config);
  assert.equal(result.model, "tabby-image-free");
});

test("readImageCreditState defaults to true when the state file is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  assert.equal(readImageCreditState(dir), true);
});

test("readImageCreditState defaults to true on unparsable JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  fs.writeFileSync(
    path.join(dir, "nexu-account-credit-state.json"),
    "{not json",
  );
  assert.equal(readImageCreditState(dir), true);
});

test("readImageCreditState returns false when hasBalance is false", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  fs.writeFileSync(
    path.join(dir, "nexu-account-credit-state.json"),
    JSON.stringify({ hasBalance: false }),
  );
  assert.equal(readImageCreditState(dir), false);
});

test("readImageCreditState returns true when hasBalance is true", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  fs.writeFileSync(
    path.join(dir, "nexu-account-credit-state.json"),
    JSON.stringify({ hasBalance: true }),
  );
  assert.equal(readImageCreditState(dir), true);
});

test("resolveLinkCredential falls back to tabby-image-free when the account has no balance, even though tabby-image is available", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  fs.writeFileSync(
    path.join(dir, "nexu-account-credit-state.json"),
    JSON.stringify({ hasBalance: false }),
  );
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image" }, { id: "tabby-image-free" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config, dir);
  assert.equal(result.model, "tabby-image-free");
});

test("resolveLinkCredential still uses tabby-image with no balance when tabby-image-free isn't on the account", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  fs.writeFileSync(
    path.join(dir, "nexu-account-credit-state.json"),
    JSON.stringify({ hasBalance: false }),
  );
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config, dir);
  assert.equal(result.model, "tabby-image");
});

test("parseImageResponse returns a b64 payload when present", () => {
  const result = parseImageResponse({ data: [{ b64_json: "abc123" }] });
  assert.deepEqual(result, { kind: "b64", data: "abc123" });
});

test("parseImageResponse returns a url when b64_json is absent", () => {
  const result = parseImageResponse({
    data: [{ url: "https://example.com/img.png" }],
  });
  assert.deepEqual(result, {
    kind: "url",
    data: "https://example.com/img.png",
  });
});

test("parseImageResponse throws BAD_RESPONSE when neither field is present", () => {
  assert.throws(() => parseImageResponse({ data: [{}] }), /BAD_RESPONSE/);
});

test("parseImageResponse throws BAD_RESPONSE when the data array is empty", () => {
  assert.throws(() => parseImageResponse({ data: [] }), /BAD_RESPONSE/);
});

test("resolveOutputPath returns an absolute filename as-is", () => {
  const result = resolveOutputPath({
    stateDir: "/state",
    cwd: "/workspace/my-bot",
    filename: "/tmp/out.png",
    skillName: "tabby-image",
  });
  assert.equal(result, "/tmp/out.png");
});

test("resolveOutputPath builds the outbound media path for relative filenames", () => {
  const result = resolveOutputPath({
    stateDir: "/state",
    cwd: "/workspace/my-bot",
    filename: "cat.png",
    skillName: "tabby-image",
  });
  assert.equal(
    result,
    path.join(
      "/state",
      "media",
      "outbound",
      "my-bot",
      "tabby-image",
      "cat.png",
    ),
  );
});
