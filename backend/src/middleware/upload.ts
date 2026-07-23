/**
 * POST /upload — multipart PDF upload (multer). Saves to
 * uploads/<jobId>/source.pdf, then registers the job via jobs.create.
 * Feathers services don't parse multipart, so uploads use this Express route.
 */

import path from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import multer from "multer";

import { UPLOADS_DIR } from "../config.js";

export function registerUpload(app: any): void {
  const storage = multer.diskStorage({
    destination: (req: any, _file: any, cb: any) => {
      const id = req.jobId ?? (req.jobId = randomUUID());
      const dir = path.join(UPLOADS_DIR, id);
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req: any, file: any, cb: any) => {
      const ext = path.extname(file.originalname || ".pdf") || ".pdf";
      cb(null, `source${ext}`);
    },
  });
  const upload = multer({ storage });

  app.post("/upload", upload.single("file"), async (req: any, res: any) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded (field name must be 'file')." });
      return;
    }
    try {
      const job = await app.service("jobs").create({
        id: req.jobId,
        file: req.file.originalname,
        pdfPath: req.file.path,
      });
      res.json(job);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });
}
