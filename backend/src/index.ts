/**
 * index.ts — start the backend. Model/OpenRouter keys are loaded by the
 * pipeline's own config (repo-root .env); this dotenv call just picks up an
 * optional backend/.env (e.g. PORT).
 */

import "dotenv/config";
import { createApp } from "./app.js";
import { PORT } from "./config.js";

const app = createApp();

app
  .listen(PORT)
  .then(() => {
    console.log(`RCC analyzer backend listening on http://localhost:${PORT}`);
    console.log(`  REST    : POST http://localhost:${PORT}/upload  (multipart 'file')`);
    console.log(`  Socket  : ws://localhost:${PORT}  (service 'jobs', event 'progress')`);
  })
  .catch((err: unknown) => {
    console.error("Failed to start backend:", err);
    process.exit(1);
  });
