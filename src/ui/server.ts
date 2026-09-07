import { createServer, type Server } from "node:http";
import { uiPage } from "./page.js";
import type { OverviewResponse, WorkItemDetail } from "./types.js";

export interface UiServerReaders {
  getOverview(): Promise<OverviewResponse>;
  getWorkItem(id: string): Promise<WorkItemDetail | undefined>;
}

function json(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

export function createUiServer(readers: UiServerReaders): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET") return json(response, 405, { error: "read-only server" });
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(uiPage);
    }
    if (url.pathname === "/api/overview") {
      try { return json(response, 200, await readers.getOverview()); } catch (error) { return json(response, 503, { error: String(error) }); }
    }
    const match = url.pathname.match(/^\/api\/work-items\/([^/]+)$/);
    if (match) {
      try {
        const item = await readers.getWorkItem(decodeURIComponent(match[1]));
        return item ? json(response, 200, item) : json(response, 404, { error: "work item not found" });
      } catch (error) { return json(response, 503, { error: String(error) }); }
    }
    return json(response, 404, { error: "not found" });
  });
}
