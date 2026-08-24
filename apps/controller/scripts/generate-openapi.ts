import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createContainer } from "../src/app/container.js";
import { createApp } from "../src/app/create-app.js";

const container = await createContainer();
const app = createApp(container);
const spec = app.getOpenAPIDocument({
  // 3.0.3, not 3.1: zod-openapi expresses nullability with the 3.0 keyword
  // `nullable: true`, which 3.1 replaced with `type: [..., "null"]`. Declaring
  // 3.1 over 3.0 output made every nullable field unreadable to the SDK
  // generator, so `string | null` came out as `string` — the generated types
  // claimed a field could never be null while the API returned null. The
  // document uses no 3.1-only construct.
  openapi: "3.0.3",
  info: { title: "nexu Controller API", version: "1.0.0" },
});

const outputPath = fileURLToPath(new URL("../openapi.json", import.meta.url));
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
console.log(`OpenAPI spec written to ${outputPath}`);
