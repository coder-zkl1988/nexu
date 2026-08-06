---
name: tabby-image
catalog-name: Tabby Image (Official)
description: Generate images through the Tabby relay with GPT Image or Agnes Image, using the models enabled for the logged-in Tabby account. Triggers on "generate image", "tabby image", "official image model", "gpt image".
metadata:
  openclaw:
    emoji: "🖼️"
---

# Tabby Image

Generates images using the image models enabled for the logged-in Tabby cloud account. No API key configuration is required; the skill reads the existing account credential and relay URL automatically.

When no model is specified, the skill prefers `tabby-image-pro` while image credit is available and falls back to `tabby-image-flash` otherwise. Use `--model` only when the user explicitly chooses one:

- `tabby-image-pro`: GPT-image-2 request format. Supports quality and transparent-background controls.
- `tabby-image-flash`: Agnes Image 2.1 Flash request format. Supports Agnes resolution and aspect-ratio controls. Keep this relay alias in the request; do not replace it with the upstream model name.

## Generate an image

```bash
node {baseDir}/scripts/generate-image.js --prompt "a cat sitting on mars" --filename "cat-on-mars.png"
```

Explicit GPT Image example:

```bash
node {baseDir}/scripts/generate-image.js --model tabby-image-pro --prompt "a transparent glass teapot" --filename "teapot.png" --ratio 16:9 --quality high --transparent-background
```

Explicit Agnes Image example:

```bash
node {baseDir}/scripts/generate-image.js --model tabby-image-flash --prompt "a quiet mountain lake at dawn" --filename "lake.png" --size 2K --ratio 16:9
```

## Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--prompt` | `-p` | required | Image description |
| `--filename` | `-f` | required | Output filename |
| `--model` | - | automatic | `tabby-image-pro` or `tabby-image-flash` |
| `--size` | - | model default | GPT: `auto`, `1K`, `2K`, `3K`, `4K`, or an exact supported `WIDTHxHEIGHT`; Agnes: `1K`, `2K`, `3K`, `4K`, or an exact supported size |
| `--ratio` | - | `1:1` orientation | `1:1`, `3:4`, `4:3`, `16:9`, `9:16`, `2:3`, `3:2`, or `21:9` |
| `--quality` | - | model default | GPT only: `auto`, `high`, `medium`, or `low` |
| `--transparent-background` | - | off | GPT only: request a transparent background |

For `tabby-image-pro`, `--ratio` selects a matching GPT-image-2 size when `--size` is omitted or uses a resolution tier. Exact GPT dimensions must be divisible by 16, stay between 1:3 and 3:1, and fit within the model limits. For `tabby-image-flash`, the ratio is sent directly using the Agnes Image request format. GPT-only quality and transparent-background controls are ignored by `tabby-image-flash`.

## Account requirements

This skill uses the Tabby cloud credential and relay URL already configured on this machine. If the script errors with "not logged in", tell the user to log into their Tabby account in the desktop app (Settings) and try again. If it reports that the account does not have access to a model, choose an available alias or check the account entitlement.

## Output

Relative filenames are saved to `$OPENCLAW_STATE_DIR/media/outbound/{slugid}/tabby-image/{filename}`. Absolute paths are used as-is. Use timestamps in filenames to avoid overwrites: `cat-on-mars-20260304-165000.png`.

## Sending images to the user

The script prints a `MEDIA: <absolute-path>` line on stdout. **You MUST include this exact MEDIA: line in your reply text** so the image is delivered as an attachment in chat.

Example reply:
```
Here's your image!
MEDIA: /Users/alche/.openclaw/media/outbound/my-bot/tabby-image/cat-on-mars.png
```

Rules:
- Copy the `MEDIA:` line from the script output into your reply verbatim — this is how images get sent
- Do NOT read the generated image back with the read tool
- Do NOT try to base64 encode or manually attach the image
- The `MEDIA:` line must be on its own line in your response

## Scope

This skill only generates new images from a text prompt. It does not support editing an existing image or combining multiple images — use a different image skill for those if one is installed.
