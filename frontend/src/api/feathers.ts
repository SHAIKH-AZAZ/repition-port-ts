/**
 * Feathers client over Socket.io. Service calls (jobs.*) travel over the socket;
 * the multipart upload uses a normal fetch to the proxied /api/upload route.
 */

import { feathers } from "@feathersjs/feathers";
import socketio from "@feathersjs/socketio-client";
import io from "socket.io-client";
import type { JobView } from "../types";

const socket = io("/", { path: "/socket.io" }); // Vite proxies to backend:4000

export const app = feathers();
app.configure(socketio(socket));

/** The jobs service (also an EventEmitter — listen for 'progress'). */
export const jobsService = app.service("jobs") as any;

/** Upload a PDF (multipart) and register a job. */
export async function uploadPdf(file: File): Promise<JobView> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

export function startJob(id: string, pages?: number[]): Promise<JobView> {
  return jobsService.patch(id, { action: "start", pages });
}

export function cancelJob(id: string): Promise<JobView> {
  return jobsService.patch(id, { action: "cancel" });
}
