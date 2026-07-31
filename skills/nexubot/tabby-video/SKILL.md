---
name: tabby-video
catalog-name: Tabby Video (Official)
description: Generate videos with the official Tabby Video model, included free with your Tabby cloud account login — no API key setup needed. Supports text-to-video, image-to-video, and keyframe animation. Triggers on "generate video", "tabby video", "official video model", "animate this image".
metadata:
  openclaw:
    emoji: "🎬"
---

# Tabby Video — Official Video Generation

Generates videos using the `tabby-video` model that comes with your logged-in Tabby cloud account. No API key configuration required — this skill reads your existing account credential automatically.

Video generation is asynchronous and can take a while (up to several minutes). This script creates the generation task and blocks until the result is ready, printing progress lines as it polls — this is expected, not a hang.

## Generate a video

Text-to-video:
```bash
node {baseDir}/scripts/generate-video.js --prompt "a cat walking on a beach at sunset" --filename "cat-beach.mp4" --model "tabby-video" --duration-seconds 5 --resolution 720p --aspect-ratio 16:9
```

Image-to-video (animate a single reference image):
```bash
node {baseDir}/scripts/generate-video.js --prompt "the character slowly turns to face the camera" --filename "turn.mp4" --image "https://example.com/portrait.png"
```

Keyframe animation (multiple images always require `--keyframes`):
```bash
node {baseDir}/scripts/generate-video.js --prompt "smooth transition between keyframes, consistent character identity" --filename "kf.mp4" --image "https://example.com/kf1.png" --image "https://example.com/kf2.png" --keyframes
```

## Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--prompt` | `-p` | required | Video description |
| `--filename` | `-f` | required | Output filename |
| `--image` | — | none | Reference image URL. Pass once for image-to-video; pass 2+ only with `--keyframes` (repeatable) |
| `--keyframes` | — | off | Treat `--image` entries as ordered keyframes (requires 2+ `--image`) |
| `--model` | — | account-selected | Configured Tabby relay alias. Use `tabby-video`; never substitute the upstream model name |
| `--negative-prompt` | — | none | Content to avoid in the generated video |
| `--duration-seconds` | — | none | Desired duration, converted to the nearest valid `8n+1` frame count; cannot combine with `--num-frames` |
| `--resolution` | — | none | `480p`, `720p`, or `1080p`; maps with `--aspect-ratio` to width/height |
| `--aspect-ratio` | — | `16:9` with resolution | `16:9`, `9:16`, `1:1`, `4:3`, or `3:4` |
| `--width` | — | `1152` when no preset | Explicit video width; requires `--height` and cannot combine with resolution/aspect options |
| `--height` | — | `768` when no preset | Explicit video height; requires `--width` and cannot combine with resolution/aspect options |
| `--num-frames` | — | `121` | Frame count. Must be `<= 441` and follow the `8n+1` rule (81, 121, 241, 441, …) |
| `--frame-rate` | — | `24` | Frames per second, 1-60 |
| `--num-inference-steps` | — | model default | Optional positive model inference step count |
| `--seed` | — | none | Seed for reproducible output |
| `--poll-interval-ms` | — | `5000` | How often to check the result while waiting |
| `--timeout-ms` | — | `600000` (10 min) | Give up waiting after this long |

Image URLs must be publicly accessible (no login/cookies required).

## Relay protocol

The script reads `baseUrl`, `apiKey`, and available model aliases from the configured `link` provider in `openclaw.json`. It never calls the Agnes official API domain directly.

- Create: `POST {configuredBaseUrl}/videos` with `model: "tabby-video"`
- Recommended poll: `GET {configuredOrigin}/agnesapi?video_id=<VIDEO_ID>`
- Legacy fallback: `GET {configuredBaseUrl}/videos/<TASK_ID>`
- Completed result URL: `metadata.url`

## Duration reference

`seconds = num_frames / frame_rate`. Common targets at 24fps:

| Target duration | `--num-frames` |
|---|---|
| ~3s | 81 |
| ~5s | 121 (default) |
| ~10s | 241 |
| ~18s | 441 (max) |

`--duration-seconds` performs this conversion automatically and rounds to the nearest valid `8n+1` frame count. If the result would exceed 441 frames, lower the duration or frame rate.

## Account requirements

This skill uses the Tabby cloud credential already configured on this machine — no separate setup. If the script errors with "not logged in", tell the user to log into their official Tabby account in the desktop app (Settings) and try again. If it errors with "does not have access to the tabby-video model", their account tier does not include video generation.

## Output

Relative filenames are saved to `$OPENCLAW_STATE_DIR/media/outbound/{slugid}/tabby-video/{filename}`. Absolute paths are used as-is. Use timestamps in filenames to avoid overwrites: `cat-beach-20260304-165000.mp4`.

## Sending videos to the user

The script prints a `MEDIA: <absolute-path>` line on stdout after the video finishes generating. **You MUST include this exact MEDIA: line in your reply text** so the video is delivered as an attachment in chat.

Example reply:
```
Here's your video!
MEDIA: /Users/alche/.openclaw/media/outbound/my-bot/tabby-video/cat-beach.mp4
```

Rules:
- Copy the `MEDIA:` line from the script output into your reply verbatim — this is how videos get sent
- Do NOT try to base64 encode or manually attach the video
- The `MEDIA:` line must be on its own line in your response
- Tell the user up front that video generation can take a few minutes so they aren't surprised by the wait

## Scope

This skill only generates new videos from a text prompt (optionally guided by reference images). It does not support editing an existing video — use a different skill for that if one is installed.
