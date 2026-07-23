# RCC Drawing Element Analyzer — TypeScript port

Direct port of the Python POC. Scans `input/` PDFs, sends each page to an OpenAI
vision model, extracts BEAM / SLAB / COLUMN / FOOTING label repetitions, and
writes a per-file JSON report to `output/`.

## Setup

```bash
npm install
cp .env.example .env      # then fill in OPENAI_API_KEY
```

## Usage

```bash
# Analyse ALL PDFs in input/
npm start

# Analyse a specific PDF inside input/
npm start -- --file drawing.pdf

# Only specific pages
npm start -- --file drawing.pdf --pages 1,3,5-8

# Custom output filename (written to output/)
npm start -- --file drawing.pdf --output my_report.json
```

Build to plain JS: `npm run build` → `dist/`, then `node dist/main.js`.
Run logic self-check: `npm run check`.

## Two-model agentic mode (Design B)

By default every page is split into a fixed grid of overlapping tiles and each
tile is sent to one vision model. Optionally you can run a **two-model** pipeline
where a stronger model decides *what to read* and a cheaper model does the reading:

1. **Cropper (strong model)** — sees a downscaled preview of the whole sheet and,
   via tool calls (`crop_region` / `finish`), marks the layout/section regions
   worth reading while ignoring schedules, title blocks and legends.
2. **Extractor (cheap model)** — each cropped region is tiled at full resolution
   (so small labels stay legible) and read for BEAM/SLAB/COLUMN/FOOTING labels.

The crops feed the *same* deterministic post-processing (cross-tile dedupe,
prefix re-bucketing, label normalisation), so output is identical in shape.

Enable it by setting `OPENAI_CROP_MODEL` in `.env`:

```bash
OPENAI_CROP_MODEL=google/gemini-2.5-pro   # strong: region cropping
OPENAI_EXTRACT_MODEL=gpt-4.1-mini         # cheap: label reading (defaults to OPENAI_VISION_MODEL)
```

Leave `OPENAI_CROP_MODEL` empty to keep the original grid-tiling pipeline.
If the cropper returns no regions or errors on a page, that page falls back to
whole-page tiling automatically. Relevant tunables live in `src/config.ts`
(`CROP_PAGE_MAX_DIM`, `MAX_CROP_CALLS`, `CROP_PROMPT`).

## Layout ↔ Python source

| TypeScript                | Python                |
|---------------------------|-----------------------|
| `src/config.ts`           | `src/config.py`       |
| `src/pdfProcessor.ts`     | `src/pdf_processor.py`|
| `src/aiExtractor.ts`      | `src/ai_extractor.py` |
| `src/main.ts`             | `main.py`             |
| `src/types.ts`            | (typed inline in Py)  |

## Notes on the port

- **PDF → image**: PyMuPDF + Pillow → [`pdf-to-img`](https://www.npmjs.com/package/pdf-to-img)
  (pdf.js, pure JS) + [`sharp`](https://sharp.pixelplumbing.com/) for the
  `MAX_IMAGE_DIM` downscale. `PDF_DPI` maps to pdf-to-img's `scale = DPI/72`.
- **CLI args**: `argparse` → Node's built-in `util.parseArgs` (no dependency).
- **OpenAI**: same Chat Completions vision call, `temperature=0`, `max_tokens=1024`,
  same retry/back-off on rate-limit and API errors, same markdown-fence stripping
  and old-format (bare-string labels) fallback in the response parser.
- Output JSON schema is identical to the Python version.
