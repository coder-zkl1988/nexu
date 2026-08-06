import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildImageGenerationRequest,
  buildImageGenerationsUrl,
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

test("resolveLinkCredential prefers tabby-image-pro over tabby-image-flash", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image-flash" }, { id: "tabby-image-pro" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config);
  assert.equal(result.model, "tabby-image-pro");
  assert.equal(result.baseUrl, "https://x/v1");
  assert.equal(result.apiKey, "key123");
});

test("resolveLinkCredential falls back to tabby-image-flash", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image-flash" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config);
  assert.equal(result.model, "tabby-image-flash");
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

test("resolveLinkCredential falls back to tabby-image-flash when the account has no balance, even though tabby-image-pro is available", () => {
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
          models: [{ id: "tabby-image-pro" }, { id: "tabby-image-flash" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config, dir);
  assert.equal(result.model, "tabby-image-flash");
});

test("resolveLinkCredential still uses tabby-image-pro with no balance when tabby-image-flash isn't on the account", () => {
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
          models: [{ id: "tabby-image-pro" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config, dir);
  assert.equal(result.model, "tabby-image-pro");
});

test("resolveLinkCredential honors an explicit pro model even without balance", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  fs.writeFileSync(
    path.join(dir, "nexu-account-credit-state.json"),
    JSON.stringify({ hasBalance: false }),
  );
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://relay.example/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image-pro" }, { id: "tabby-image-flash" }],
        },
      },
    },
  };

  const result = resolveLinkCredential(config, dir, "tabby-image-pro");

  assert.equal(result.model, "tabby-image-pro");
});

test("resolveLinkCredential honors an explicit flash model", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://relay.example/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image-pro" }, { id: "tabby-image-flash" }],
        },
      },
    },
  };

  const result = resolveLinkCredential(config, undefined, "tabby-image-flash");

  assert.equal(result.model, "tabby-image-flash");
});

test("resolveLinkCredential rejects an explicit model missing from the account", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://relay.example/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image-flash" }],
        },
      },
    },
  };

  assert.throws(
    () => resolveLinkCredential(config, undefined, "tabby-image-pro"),
    /NO_IMAGE_MODEL.*tabby-image-pro/,
  );
});

test("resolveLinkCredential rejects a non-relay image model alias", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://relay.example/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image-pro" }],
        },
      },
    },
  };

  assert.throws(
    () => resolveLinkCredential(config, undefined, "gpt-image-2"),
    /INVALID_IMAGE_MODEL/,
  );
});

test("buildImageGenerationsUrl uses the configured relay and normalizes trailing slashes", () => {
  assert.equal(
    buildImageGenerationsUrl("https://relay.example/v1///"),
    "https://relay.example/v1/images/generations",
  );
});

test("buildImageGenerationRequest builds the exact GPT Image body", () => {
  const result = buildImageGenerationRequest({
    baseUrl: "https://relay.example/v1",
    model: "tabby-image-pro",
    prompt: "a cat on mars",
  });

  assert.equal(result.url, "https://relay.example/v1/images/generations");
  assert.deepEqual(result.body, {
    model: "tabby-image-pro",
    prompt: "a cat on mars",
    n: 1,
    size: "1024x1024",
  });
  assert.equal(Object.hasOwn(result.body, "response_format"), false);
  assert.equal(Object.hasOwn(result.body, "extra_body"), false);
});

test("buildImageGenerationRequest maps GPT ratio and optional controls", () => {
  const result = buildImageGenerationRequest({
    baseUrl: "https://relay.example/v1/",
    model: "tabby-image-pro",
    prompt: "product shot",
    ratio: "16:9",
    quality: "high",
    transparentBackground: true,
  });

  assert.deepEqual(result.body, {
    model: "tabby-image-pro",
    prompt: "product shot",
    n: 1,
    size: "1536x864",
    quality: "high",
    background: "transparent",
  });
  assert.equal(Object.hasOwn(result.body, "ratio"), false);
});

test("buildImageGenerationRequest builds the exact Agnes URL-output body", () => {
  const result = buildImageGenerationRequest({
    baseUrl: "https://relay.example/v1",
    model: "tabby-image-flash",
    prompt: "a luminous city",
    size: "2K",
    ratio: "16:9",
  });

  assert.equal(result.url, "https://relay.example/v1/images/generations");
  assert.deepEqual(result.body, {
    model: "tabby-image-flash",
    prompt: "a luminous city",
    size: "2K",
    extra_body: { response_format: "url" },
    ratio: "16:9",
  });
  assert.equal(Object.hasOwn(result.body, "n"), false);
  assert.equal(Object.hasOwn(result.body, "response_format"), false);
});

test("buildImageGenerationRequest defaults Agnes to 1K and keeps the relay alias", () => {
  const result = buildImageGenerationRequest({
    baseUrl: "https://relay.example/v1",
    model: "tabby-image-flash",
    prompt: "a studio portrait",
  });

  assert.deepEqual(result.body, {
    model: "tabby-image-flash",
    prompt: "a studio portrait",
    size: "1K",
    extra_body: { response_format: "url" },
  });
});

test("buildImageGenerationRequest omits GPT-only controls for Agnes", () => {
  const result = buildImageGenerationRequest({
    baseUrl: "https://relay.example/v1",
    model: "tabby-image-flash",
    prompt: "a cat",
    quality: "high",
    transparentBackground: true,
  });

  assert.deepEqual(result.body, {
    model: "tabby-image-flash",
    prompt: "a cat",
    size: "1K",
    extra_body: { response_format: "url" },
  });
});

test("buildImageGenerationRequest maps GPT tiers and validates exact sizes", () => {
  assert.equal(
    buildImageGenerationRequest({
      baseUrl: "https://relay.example/v1",
      model: "tabby-image-pro",
      prompt: "a cat",
      size: "2K",
      ratio: "9:16",
    }).body.size,
    "1152x2048",
  );
  assert.equal(
    buildImageGenerationRequest({
      baseUrl: "https://relay.example/v1",
      model: "tabby-image-pro",
      prompt: "a cat",
      size: "4K",
      ratio: "1:1",
    }).body.size,
    "2160x2160",
  );
  assert.equal(
    buildImageGenerationRequest({
      baseUrl: "https://relay.example/v1",
      model: "tabby-image-pro",
      prompt: "a cat",
      size: "1536x864",
    }).body.size,
    "1536x864",
  );

  assert.throws(
    () =>
      buildImageGenerationRequest({
        baseUrl: "https://relay.example/v1",
        model: "tabby-image-flash",
        prompt: "a cat",
        ratio: "5:4",
      }),
    /INVALID_RATIO/,
  );
  assert.throws(
    () =>
      buildImageGenerationRequest({
        baseUrl: "https://relay.example/v1",
        model: "tabby-image-pro",
        prompt: "a cat",
        size: "1537x864",
      }),
    /INVALID_SIZE/,
  );
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
