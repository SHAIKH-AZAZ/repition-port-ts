/**
 * channels.ts — decide who receives the jobs `progress` event.
 *
 * Local single-user: every connection joins "everybody" and receives all
 * progress events; the client filters by jobId. For multi-user later, publish
 * to a per-job channel (`app.channel('job/' + data.jobId)`) that clients join.
 */

export function setupChannels(app: any): void {
  if (typeof app.channel !== "function") return; // no realtime provider configured

  app.on("connection", (connection: any) => {
    app.channel("everybody").join(connection);
  });

  app.service("jobs").publish("progress", () => app.channel("everybody"));
}
