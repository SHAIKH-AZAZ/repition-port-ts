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
