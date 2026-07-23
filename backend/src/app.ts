/**
 * app.ts — build the Feathers (Express transport) application.
 * REST + Socket.io, the in-memory `jobs` service with its `progress` event,
 * the multipart upload route, and static serving of crops + source PDFs.
 */

import { feathers } from "@feathersjs/feathers";
import feathersExpress, {
  rest,
  json,
  urlencoded,
  notFound,
  errorHandler,
} from "@feathersjs/express";
import socketio from "@feathersjs/socketio";
import cors from "cors";
import expressLib from "express";
import { mkdirSync } from "node:fs";

import { UPLOADS_DIR, OUTPUTS_DIR } from "./config.js";
import { JobsService } from "./services/jobs/jobs.class.js";
import { registerUpload } from "./middleware/upload.js";
import { setupChannels } from "./channels.js";

export function createApp(): any {
  mkdirSync(UPLOADS_DIR, { recursive: true });
  mkdirSync(OUTPUTS_DIR, { recursive: true });

  const app: any = feathersExpress(feathers());

  app.use(cors());
  app.use(json({ limit: "25mb" }));
  app.use(urlencoded({ extended: true }));
  app.configure(rest());
  app.configure(socketio({ cors: { origin: "*" } }));

  // Static: crop images/JSON (OUTPUTS_DIR) and original PDFs (UPLOADS_DIR).
  app.use("/crops", expressLib.static(OUTPUTS_DIR));
  app.use("/pdf", expressLib.static(UPLOADS_DIR));

  // jobs service with the custom realtime event.
  app.use("jobs", new JobsService(app), {
    methods: ["find", "get", "create", "patch"],
    events: ["progress"],
  });

  // Multipart upload route (before the Feathers 404/error handlers).
  registerUpload(app);

  setupChannels(app);

  app.use(notFound());
  app.use(errorHandler());
  return app;
}
