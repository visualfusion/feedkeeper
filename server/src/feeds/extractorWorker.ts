import { parentPort } from "node:worker_threads";
import { parseArticleHtml } from "./extractorParser.js";

interface WorkerRequest {
  id: number;
  html: string;
  url: string;
}

parentPort?.on("message", (task: WorkerRequest) => {
  try {
    const result = parseArticleHtml(task.html, task.url);
    parentPort?.postMessage({ id: task.id, result });
  } catch (error) {
    parentPort?.postMessage({ id: task.id, error: error instanceof Error ? error.message : "worker_parse_failed" });
  }
});
