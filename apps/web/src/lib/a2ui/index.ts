import "./a2ui.css";

export { A2UIRenderer, A2UIErrorBoundary } from "./a2ui-renderer";
export type { A2UIRendererProps } from "./a2ui-renderer";
export type {
  A2UIMessage,
  A2UIComponent,
  SurfaceState,
  ComponentId,
  CreateSurfaceMessage,
  UpdateComponentsMessage,
  UpdateDataModelMessage,
  DeleteSurfaceMessage,
} from "./a2ui-types";
export { createSurfaceManager } from "./a2ui-surface";
export type { SurfaceManager } from "./a2ui-surface";
export {
  registerCustomComponent,
  resolveCustomComponent,
} from "./custom-components/registry";
export type { CustomComponentProps } from "./custom-components/registry";

import { ExpertInstallCard } from "./custom-components/ExpertInstallCard";
import { MarkdownEditor } from "./custom-components/MarkdownEditor";
import { PhonePreview } from "./custom-components/PhonePreview";
import { XHSBatchTable } from "./custom-components/XHSBatchTable";
import { XHSEditor } from "./custom-components/XHSEditor";
// ── Register Nexu custom components ───────────────────────────
import { registerCustomComponent } from "./custom-components/registry";

const NEXU_CATALOG = "https://nexu.app/a2ui/custom-catalog.json";

registerCustomComponent(NEXU_CATALOG, "ExpertInstallCard", ExpertInstallCard);
registerCustomComponent(NEXU_CATALOG, "MarkdownEditor", MarkdownEditor);
registerCustomComponent(NEXU_CATALOG, "PhonePreview", PhonePreview);
registerCustomComponent(NEXU_CATALOG, "XHSEditor", XHSEditor);
registerCustomComponent(NEXU_CATALOG, "XHSBatchTable", XHSBatchTable);
