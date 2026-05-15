const COMPONENT_SCHEMAS = [
  {
    type: "Text",
    required: ["id", "type", "content"],
    properties: {
      id: { type: "string" },
      type: { const: "Text" },
      content: {
        oneOf: [
          { type: "string", description: "Static text content" },
          {
            type: "object",
            properties: { path: { type: "string" } },
            description: "Data binding to a JSON pointer path",
          },
        ],
      },
      variant: {
        type: "string",
        enum: ["h1", "h2", "h3", "h4", "h5", "body", "caption", "code"],
      },
    },
  },
  {
    type: "Button",
    required: ["id", "type", "label"],
    properties: {
      id: { type: "string" },
      type: { const: "Button" },
      label: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { path: { type: "string" } } },
        ],
      },
      variant: {
        type: "string",
        enum: ["primary", "secondary", "outlined", "text"],
      },
      action: {
        type: "object",
        properties: {
          event: {
            type: "object",
            properties: {
              name: { type: "string" },
              context: { type: "object" },
            },
            required: ["name"],
          },
        },
      },
      disabled: { type: "boolean" },
      children: {
        type: "array",
        items: { type: "string" },
        description: "Child component IDs",
      },
    },
  },
  {
    type: "TextField",
    required: ["id", "type"],
    properties: {
      id: { type: "string" },
      type: { const: "TextField" },
      label: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { path: { type: "string" } } },
        ],
      },
      value: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { path: { type: "string" } } },
        ],
      },
      placeholder: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { path: { type: "string" } } },
        ],
      },
      hint: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { path: { type: "string" } } },
        ],
      },
      multiline: { type: "boolean" },
      required: { type: "boolean" },
    },
  },
  {
    type: "DateTimeInput",
    required: ["id", "type"],
    properties: {
      id: { type: "string" },
      type: { const: "DateTimeInput" },
      label: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { path: { type: "string" } } },
        ],
      },
      value: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { path: { type: "string" } } },
        ],
      },
      mode: { type: "string", enum: ["date", "time", "datetime"] },
    },
  },
  {
    type: "CheckBox",
    required: ["id", "type", "label"],
    properties: {
      id: { type: "string" },
      type: { const: "CheckBox" },
      label: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { path: { type: "string" } } },
        ],
      },
      checked: { type: "boolean" },
    },
  },
  {
    type: "ChoicePicker",
    required: ["id", "type", "choices"],
    properties: {
      id: { type: "string" },
      type: { const: "ChoicePicker" },
      label: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { path: { type: "string" } } },
        ],
      },
      choices: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
          },
          required: ["label", "value"],
        },
      },
      selected: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { path: { type: "string" } } },
        ],
      },
    },
  },
  {
    type: "Slider",
    required: ["id", "type"],
    properties: {
      id: { type: "string" },
      type: { const: "Slider" },
      label: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { path: { type: "string" } } },
        ],
      },
      value: { type: "number" },
      min: { type: "number" },
      max: { type: "number" },
      step: { type: "number" },
    },
  },
  {
    type: "Column",
    required: ["id", "type", "children"],
    properties: {
      id: { type: "string" },
      type: { const: "Column" },
      children: {
        type: "array",
        items: { type: "string" },
        description: "Child component IDs",
      },
      gap: { type: "number" },
      alignment: {
        type: "string",
        enum: ["start", "center", "end", "stretch"],
      },
    },
  },
  {
    type: "Row",
    required: ["id", "type", "children"],
    properties: {
      id: { type: "string" },
      type: { const: "Row" },
      children: {
        type: "array",
        items: { type: "string" },
        description: "Child component IDs",
      },
      gap: { type: "number" },
      alignment: {
        type: "string",
        enum: ["start", "center", "end", "stretch"],
      },
    },
  },
  {
    type: "Card",
    required: ["id", "type", "children"],
    properties: {
      id: { type: "string" },
      type: { const: "Card" },
      children: {
        type: "array",
        items: { type: "string" },
        description: "Child component IDs",
      },
      padding: { type: "number" },
      elevation: { type: "number" },
    },
  },
  {
    type: "List",
    required: ["id", "type", "children"],
    properties: {
      id: { type: "string" },
      type: { const: "List" },
      children: {
        type: "array",
        items: { type: "string" },
        description: "Child component IDs",
      },
      orientation: { type: "string", enum: ["vertical", "horizontal"] },
      gap: { type: "number" },
    },
  },
  {
    type: "Tabs",
    required: ["id", "type", "tabs"],
    properties: {
      id: { type: "string" },
      type: { const: "Tabs" },
      tabs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            children: {
              type: "array",
              items: { type: "string" },
              description: "Child component IDs for this tab",
            },
          },
          required: ["label", "children"],
        },
      },
      selectedIndex: { type: "number" },
    },
  },
  {
    type: "Modal",
    required: ["id", "type", "children", "open"],
    properties: {
      id: { type: "string" },
      type: { const: "Modal" },
      children: {
        type: "array",
        items: { type: "string" },
        description: "Child component IDs",
      },
      open: { type: "boolean" },
      title: { type: "string" },
    },
  },
  {
    type: "Image",
    required: ["id", "type", "source"],
    properties: {
      id: { type: "string" },
      type: { const: "Image" },
      source: { type: "string", description: "Image URL" },
      alt: { type: "string" },
      width: { type: "number" },
      height: { type: "number" },
    },
  },
  {
    type: "Icon",
    required: ["id", "type", "name"],
    properties: {
      id: { type: "string" },
      type: { const: "Icon" },
      name: { type: "string", description: "Icon name" },
      color: { type: "string" },
      size: { type: "number" },
    },
  },
  {
    type: "Divider",
    required: ["id", "type"],
    properties: {
      id: { type: "string" },
      type: { const: "Divider" },
      orientation: { type: "string", enum: ["horizontal", "vertical"] },
    },
  },
  {
    type: "Video",
    required: ["id", "type", "source"],
    properties: {
      id: { type: "string" },
      type: { const: "Video" },
      source: { type: "string", description: "Video URL" },
      autoplay: { type: "boolean" },
      muted: { type: "boolean" },
    },
  },
  {
    type: "AudioPlayer",
    required: ["id", "type", "source"],
    properties: {
      id: { type: "string" },
      type: { const: "AudioPlayer" },
      source: { type: "string", description: "Audio URL" },
      title: { type: "string" },
    },
  },
  {
    type: "PhonePreview",
    required: ["id", "type"],
    properties: {
      id: { type: "string" },
      type: { const: "PhonePreview" },
      devices: {
        type: "array",
        description: "Array of connected phone devices to display",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Device name" },
            model: { type: "string", description: "Device model" },
            status: {
              type: "string",
              enum: ["online", "offline", "busy"],
              description: "Connection status",
            },
            screenshot: {
              type: "string",
              description: "Screenshot image URL or data URI",
            },
          },
          required: ["name"],
        },
      },
    },
  },
  {
    type: "MarkdownEditor",
    required: ["id", "type", "content"],
    properties: {
      id: { type: "string" },
      type: { const: "MarkdownEditor" },
      title: { type: "string", description: "Optional editor title" },
      content: { type: "string", description: "Markdown content to display" },
    },
  },
];

/**
 * Convert simplified component definitions to A2UI v0.9 JSONL.
 *
 * IMPORTANT: This is NOT OpenClaw Canvas format. Do NOT use literalString,
 * explicitList, function, or beginRendering. Use plain strings, plain arrays,
 * and event-based actions ONLY.
 */
function generateA2UIJSONL(surfaceId, components, initialData, catalogId) {
  const lines = [];

  const createSurface = { surfaceId };
  if (catalogId) createSurface.catalogId = catalogId;

  lines.push(
    JSON.stringify({
      version: "v0.9",
      createSurface,
    }),
  );

  lines.push(
    JSON.stringify({
      version: "v0.9",
      updateComponents: { surfaceId, components },
    }),
  );

  if (initialData && typeof initialData === "object") {
    for (const [key, value] of Object.entries(initialData)) {
      lines.push(
        JSON.stringify({
          version: "v0.9",
          updateDataModel: {
            surfaceId,
            path: `/${key}`,
            value,
          },
        }),
      );
    }
  }

  return lines.join("\n");
}

const plugin = {
  id: "nexu-a2ui",
  name: "Nexu A2UI Renderer",
  description:
    "Registers the render_a2ui tool for rendering interactive UI components directly in chat messages.",
  register(api) {
    api.registerTool({
      name: "render_a2ui",
      label: "Render Interactive UI",
      description: `Render interactive UI components (forms, buttons, date pickers, sliders, etc.) directly in the chat.

WHEN TO USE:
- Displaying connected phone/device status — use PhonePreview component
- Showing copywriting, markdown, or generated text content — use MarkdownEditor component
- Collecting structured input from the user (forms, date/time, choices)
- Offering selectable actions (confirm/cancel, option selection)
- Any situation where plain text alone is insufficient

HOW TO USE:
1. Call this tool with a unique surfaceId and an array of component definitions.
2. The tool result is automatically rendered as interactive UI. Do NOT copy, repeat, or echo the JSONL in your text response. Just reply naturally — the UI appears alongside your message.
3. CRITICAL: NEVER include raw JSONL or \`\`\`a2ui code blocks in your text output. The system renders UI automatically. Your text and A2UI are separate.

BUTTON ACTIONS:
- Use \`"action": {"event": {"name": "actionName", "context": {}}}\` for buttons.
- When the user clicks, you receive the action name and context in your next message.

DATA BINDING:
- Use \`{"path": "/json/pointer"}\` instead of a literal value to bind to the data model.
- Use \`updateDataModel\` messages to change data values.

COMPONENT TREE:
- Each component has a unique "id". Container components (Column, Row, Card, List, Tabs, Modal) reference child components by their IDs in the "children" array.
- The root-level components become the top-level UI elements.

NOTE: This is standard A2UI v0.9 format. It is NOT OpenClaw Canvas format — do not use "literalString", "explicitList", "function", or "beginRendering".

CUSTOM COMPONENTS:
- PhonePreview: Show connected phone devices with name, model, status, and screenshot. Use catalogId: "https://nexu.app/a2ui/custom-catalog.json" when using this.
- MarkdownEditor: Display markdown/copywriting content with a copy button. Use catalogId: "https://nexu.app/a2ui/custom-catalog.json" when using this.`,

            parameters: {
              type: "object",
              properties: {
                surfaceId: {
                  type: "string",
                  description:
                    "Unique identifier for this UI surface (e.g. 'registration-form', 'booking-ui')",
                },
                catalogId: {
                  type: "string",
                  description:
                    "Catalog ID for custom components. Use 'https://nexu.app/a2ui/custom-catalog.json' when using PhonePreview or MarkdownEditor components. Omit for standard components.",
                },
              components: {
                type: "array",
                description:
                  "Array of component definitions. Each component must have a unique 'id' and a 'type'. Container components reference children by ID.",
                items: {
                  oneOf: COMPONENT_SCHEMAS.map((s) => ({
                    type: "object",
                    properties: s.properties,
                    required: s.required,
                    additionalProperties: false,
                  })),
                },
              },
              initialData: {
                type: "object",
                description:
                  "Optional initial data model values. Each key becomes a top-level path in the data model. Use this to pre-fill form values.",
              },
            },
            required: ["surfaceId", "components"],
          },

          async execute(_toolCallId, params) {
            const jsonl = generateA2UIJSONL(
              params.surfaceId,
              params.components,
              params.initialData,
              params.catalogId,
            );

            return {
              content: [
                {
                  type: "text",
                  text: ["```a2ui", jsonl, "```"].join("\n"),
                },
              ],
            };
          },
    });
  },
};

export default plugin;
