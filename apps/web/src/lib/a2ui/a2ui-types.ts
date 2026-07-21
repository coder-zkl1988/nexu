// A2UI v0.9 protocol types based on https://a2ui.org/specification/v0_9/

// ── Primitives ──────────────────────────────────────────────

export type ComponentId = string;

export interface AccessibilityAttributes {
  label?: string;
  role?: string;
  liveRegion?: "polite" | "assertive";
}

export interface ComponentCommon {
  id: ComponentId;
  accessibility?: AccessibilityAttributes;
  visible?: boolean;
}

export interface DataBinding {
  path: string;
}

export type DynamicString = string | DataBinding | FunctionCall;

export type DynamicNumber = number | DataBinding | FunctionCall;

export type DynamicBoolean = boolean | DataBinding | FunctionCall;

export type DynamicStringList = string[] | DataBinding | FunctionCall;

export interface FunctionCall {
  function: string;
  args?: Record<string, unknown>;
}

// ── Child lists ─────────────────────────────────────────────

export type ChildList =
  | ComponentId[]
  | { componentId: ComponentId; path: string };

// ── Actions ─────────────────────────────────────────────────

export interface ActionEvent {
  event: {
    name: string;
    context?: Record<string, unknown>;
  };
}

export type Action = ActionEvent | FunctionCall;

// ── Check rules ─────────────────────────────────────────────

export type CheckRule =
  | { path: string; equals?: unknown; notEquals?: unknown }
  | { not: CheckRule }
  | { and: CheckRule[] }
  | { or: CheckRule[] };

export interface Checkable {
  check?: CheckRule;
  checkState?: DynamicBoolean;
}

// ── Component definitions ───────────────────────────────────

export type ComponentType =
  | "Text"
  | "Image"
  | "Icon"
  | "Video"
  | "AudioPlayer"
  | "Row"
  | "Column"
  | "List"
  | "Card"
  | "Tabs"
  | "Modal"
  | "Divider"
  | "Button"
  | "TextField"
  | "CheckBox"
  | "ChoicePicker"
  | "Slider"
  | "DateTimeInput";

export interface BaseComponent extends ComponentCommon {
  type: ComponentType;
}

export interface TextComponent extends BaseComponent {
  type: "Text";
  content: DynamicString;
  variant?: "h1" | "h2" | "h3" | "h4" | "h5" | "body" | "caption" | "code";
}

export interface ImageComponent extends BaseComponent {
  type: "Image";
  source: DynamicString;
  alt?: DynamicString;
  width?: DynamicNumber;
  height?: DynamicNumber;
  objectFit?: "cover" | "contain" | "fill" | "none";
}

export interface IconComponent extends BaseComponent {
  type: "Icon";
  name: DynamicString;
  color?: DynamicString;
  size?: DynamicNumber;
}

export interface VideoComponent extends BaseComponent {
  type: "Video";
  source: DynamicString;
  autoplay?: DynamicBoolean;
  muted?: DynamicBoolean;
  /** Preview image shown before playback (adopted from A2UI v1.0). */
  posterUrl?: DynamicString;
}

export interface AudioPlayerComponent extends BaseComponent {
  type: "AudioPlayer";
  source: DynamicString;
  title?: DynamicString;
}

export interface RowComponent extends BaseComponent {
  type: "Row";
  children: ChildList;
  gap?: DynamicNumber;
  alignment?: "start" | "center" | "end" | "stretch";
}

export interface ColumnComponent extends BaseComponent {
  type: "Column";
  children: ChildList;
  gap?: DynamicNumber;
  alignment?: "start" | "center" | "end" | "stretch";
}

export interface ListComponent extends BaseComponent {
  type: "List";
  children: ChildList;
  orientation?: "vertical" | "horizontal";
  gap?: DynamicNumber;
}

export interface CardComponent extends BaseComponent {
  type: "Card";
  children: ChildList;
  padding?: DynamicNumber;
  elevation?: DynamicNumber;
}

export interface TabsComponent extends BaseComponent {
  type: "Tabs";
  tabs: Array<{
    label: DynamicString;
    children: ChildList;
  }>;
  selectedIndex?: DynamicNumber;
}

export interface ModalComponent extends BaseComponent {
  type: "Modal";
  children: ChildList;
  open: DynamicBoolean;
  title?: DynamicString;
}

export interface DividerComponent extends BaseComponent {
  type: "Divider";
  orientation?: "horizontal" | "vertical";
  thickness?: DynamicNumber;
  color?: DynamicString;
}

export interface ButtonComponent extends BaseComponent, Checkable {
  type: "Button";
  label: DynamicString;
  variant?: "primary" | "secondary" | "outlined" | "text";
  action?: Action;
  disabled?: DynamicBoolean;
}

export interface TextFieldComponent extends BaseComponent {
  type: "TextField";
  label?: DynamicString;
  value?: DynamicString;
  placeholder?: DynamicString;
  hint?: DynamicString;
  error?: DynamicString;
  multiline?: DynamicBoolean;
  required?: DynamicBoolean;
  path?: string;
}

export interface CheckBoxComponent extends BaseComponent {
  type: "CheckBox";
  label: DynamicString;
  checked?: DynamicBoolean;
  path?: string;
}

export interface ChoicePickerComponent extends BaseComponent {
  type: "ChoicePicker";
  label?: DynamicString;
  choices: Array<{ label: DynamicString; value: string }>;
  selected?: DynamicString;
  path?: string;
}

export interface SliderComponent extends BaseComponent {
  type: "Slider";
  label?: DynamicString;
  value?: DynamicNumber;
  min?: DynamicNumber;
  max?: DynamicNumber;
  step?: DynamicNumber;
  /**
   * Number of discrete divisions across the range; the slider snaps to
   * (max - min) / steps intervals (adopted from A2UI v1.0). Takes
   * precedence over `step` when both are present.
   */
  steps?: number;
  path?: string;
}

export interface DateTimeInputComponent extends BaseComponent {
  type: "DateTimeInput";
  label?: DynamicString;
  value?: DynamicString;
  mode?: "date" | "time" | "datetime";
  path?: string;
}

export type A2UIComponent =
  | TextComponent
  | ImageComponent
  | IconComponent
  | VideoComponent
  | AudioPlayerComponent
  | RowComponent
  | ColumnComponent
  | ListComponent
  | CardComponent
  | TabsComponent
  | ModalComponent
  | DividerComponent
  | ButtonComponent
  | TextFieldComponent
  | CheckBoxComponent
  | ChoicePickerComponent
  | SliderComponent
  | DateTimeInputComponent;

// ── A2UI messages (JSONL streaming) ────────────────────────

export interface CreateSurfaceMessage {
  version: "v0.9";
  createSurface: {
    surfaceId: string;
    catalogId?: string;
    /** Inline initial components (adopted from A2UI v1.0) — lets a single
     * message build the whole UI instead of a separate updateComponents. */
    components?: A2UIComponent[];
    /** Inline initial data model state (adopted from A2UI v1.0). */
    dataModel?: Record<string, unknown>;
  };
}

export interface UpdateComponentsMessage {
  version: "v0.9";
  updateComponents: {
    surfaceId: string;
    components: A2UIComponent[];
  };
}

export interface UpdateDataModelMessage {
  version: "v0.9";
  updateDataModel: {
    surfaceId: string;
    path: string;
    value: unknown;
  };
}

export interface DeleteSurfaceMessage {
  version: "v0.9";
  deleteSurface: {
    surfaceId: string;
  };
}

export type A2UIMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage;

// ── Surface state ───────────────────────────────────────────

export interface SurfaceState {
  surfaceId: string;
  catalogId: string;
  components: Map<ComponentId, A2UIComponent>;
  dataModel: Record<string, unknown>;
  rootComponentIds: ComponentId[];
}
