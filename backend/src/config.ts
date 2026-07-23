import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** backend/ root (one level above src/). */
export const BACKEND_ROOT = path.resolve(__dirname, "..");

/** Uploaded PDFs, one folder per job: uploads/<jobId>/source.pdf */
export const UPLOADS_DIR = path.join(BACKEND_ROOT, "uploads");

/** Per-job outputs: outputs/<jobId>/summary.json + outputs/<jobId>/crops/... */
export const OUTPUTS_DIR = path.join(BACKEND_ROOT, "outputs");

export const PORT = Number(process.env.PORT ?? 4000);
