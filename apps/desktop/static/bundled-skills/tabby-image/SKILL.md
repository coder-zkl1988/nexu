---
name: tabby-image
catalog-name: Tabby Image (Official)
description: Generate images with the official Tabby Image model (GPT-image-2), included free with your Tabby cloud account login — no API key setup needed. Triggers on "generate image", "tabby image", "official image model", "gpt image".
metadata:
  openclaw:
    emoji: "🖼️"
---

# Tabby Image — Official Image Generation

Generates images using the `tabby-image` model that comes with your logged-in Tabby cloud account. No API key configuration required — this skill reads your existing account credential automatically.

## Generate an image

```bash
node {baseDir}/scripts/generate-image.js --prompt "a cat sitting on mars" --filename "cat-on-mars.png"
```

## Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--prompt` | `-p` | required | Image description |
| `--filename` | `-f` | required | Output filename |
| `--size` | — | `1024x1024` | Image size, e.g. `1024x1024`, `1024x1536`, `1536x1024` |

## Account requirements

This skill uses the Tabby cloud credential already configured on this machine — no separate setup. If the script errors with "not logged in", tell the user to log into their official Tabby account in the desktop app (Settings) and try again. If it errors with "does not have access to the tabby-image model", their account tier does not include image generation.

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
