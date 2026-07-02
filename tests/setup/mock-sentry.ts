import { vi } from "vitest";

/**
 * Global mock for `@sentry/electron/main`.
 *
 * The real Sentry ESM entry does `import { app, screen } from "electron"`. In the
 * unit-test environment the `electron` npm package is the path-stub (CJS module
 * exporting a binary path string), so that ESM named import fails at link time
 * with "does not provide an export named 'app'" — preventing any test that
 * transitively loads a main-process module (telemetry.ts, index.ts, ipc.ts,
 * diagnostics-export.ts) from even importing. Sentry is an external runtime
 * integration; tests should not depend on its internals, so we stub it out
 * globally here with no-op implementations of the API surface the app uses.
 */
const scopeMock = () => ({
  setTag: vi.fn(),
  setExtra: vi.fn(),
  setFingerprint: vi.fn(),
  setContext: vi.fn(),
  addAttachment: vi.fn(),
  clear: vi.fn(),
});

vi.mock("@sentry/electron/main", () => ({
  init: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  flush: vi.fn().mockResolvedValue(undefined),
  isInitialized: vi.fn(() => false),
  setContext: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  getCurrentScope: vi.fn(() => scopeMock()),
  withScope: vi.fn((cb: (scope: ReturnType<typeof scopeMock>) => void) =>
    cb(scopeMock()),
  ),
}));
