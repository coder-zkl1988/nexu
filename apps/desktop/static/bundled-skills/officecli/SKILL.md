---
name: officecli
catalog-name: Office Documents
description: Create, read, edit, validate, and render Word (.docx), Excel (.xlsx), and PowerPoint (.pptx) files with the OfficeCLI binary bundled in Tabby. Use whenever an Office file is attached or the user requests an Office deliverable.
---

# OfficeCLI

Use the application-bundled OfficeCLI for every `.docx`, `.xlsx`, and `.pptx`
task. The executable path is available as `OFFICECLI_BIN`; fall back to
`officecli` only in local development. Use the syntax for the current shell.

```bash
OFFICECLI="${OFFICECLI_BIN:-officecli}"
"$OFFICECLI" --version
```

```powershell
$OfficeCli = if ($env:OFFICECLI_BIN) { $env:OFFICECLI_BIN } else { "officecli" }
& $OfficeCli --version
```

## Safety rules

1. Preserve the user's source file. Copy it to a new output path before editing
   unless the user explicitly asks to overwrite it.
2. Keep final deliverables under `$OPENCLAW_STATE_DIR/media/officecli/` so Tabby
   can expose a download card in chat.
3. Use the least destructive level that works:
   - L1: `view`, `get`, `query`
   - L2: `set`, `add`, `remove`, `move`, `swap`, `batch`
   - L3: `raw`, `raw-set`, `add-part` only when the document model cannot express
     the required change.
4. Run `validate` after every edit. Also render an HTML or screenshot preview and
   inspect it before claiming completion.
5. Emit exactly one `MEDIA: <absolute-output-path>` line for each final file.
   Do not emit temporary previews or intermediate copies as MEDIA attachments.

## Discover commands before editing

Do not guess element paths or property names. Query the installed version:

```bash
"$OFFICECLI" help
"$OFFICECLI" help docx
"$OFFICECLI" help xlsx
"$OFFICECLI" help pptx
"$OFFICECLI" help <format> <verb> <element>
```

## Read and inspect

```bash
"$OFFICECLI" view input.docx text --max-lines 200
"$OFFICECLI" view workbook.xlsx text --max-lines 200
"$OFFICECLI" view deck.pptx outline
"$OFFICECLI" query input.docx 'p[text*="keyword"]' --json
"$OFFICECLI" get workbook.xlsx '/Sheet1/A1:C20' --json
```

## Create or edit

Create the destination directory and work on a copy. On POSIX shells:

```bash
OUT_DIR="$OPENCLAW_STATE_DIR/media/officecli"
mkdir -p "$OUT_DIR"
cp -- input.docx "$OUT_DIR/revised.docx"
"$OFFICECLI" set "$OUT_DIR/revised.docx" '/body/p[1]' --prop text='Updated title'
```

On PowerShell:

```powershell
$OutDir = Join-Path $env:OPENCLAW_STATE_DIR "media/officecli"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Output = Join-Path $OutDir "revised.docx"
Copy-Item -LiteralPath "input.docx" -Destination $Output
& $OfficeCli set $Output "/body/p[1]" --prop "text=Updated title"
```

For multiple edits, prefer one `batch` call so the document is opened and saved
once. Use `officecli help batch` for the current JSON schema.

## Validate and preview

```bash
"$OFFICECLI" validate "$OUT_DIR/revised.docx" --json
"$OFFICECLI" view "$OUT_DIR/revised.docx" html -o "$OUT_DIR/revised.html"
"$OFFICECLI" view "$OUT_DIR/revised.docx" screenshot --page 1 --render html -o "$OUT_DIR/revised-preview.png"
```

Review the validation output and preview. Return the Office file as the final
deliverable; previews are evidence, not substitutes for the requested file.
