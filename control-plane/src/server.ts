import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { type AuditModel } from "./audit.js";
import { type Authorizer } from "./auth.js";

/**
 * The review and audit dashboard, served over HTTP.
 *
 * Every route that exposes vault content is gated by the Authorizer and fails
 * closed. There are no write routes at all: the dashboard only reads. The
 * request handler is a pure function of (method, path, headers) so it can be
 * tested without binding a socket; the http wrapper is a thin shell over it.
 */

export interface ServerDeps {
  authorize: Authorizer;
  audit: () => Promise<AuditModel>;
}

export interface HttpResult {
  status: number;
  contentType: string;
  body: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function json(status: number, value: unknown): HttpResult {
  return { status, contentType: "application/json", body: `${JSON.stringify(value, null, 2)}\n` };
}

function renderDashboard(model: AuditModel): string {
  const statusRows = Object.entries(model.counts.byStatus)
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`)
    .join("");
  const recent = model.writebacks.recent
    .map((c) => `<li>${escapeHtml(c.date)} - ${escapeHtml(c.author)}: ${escapeHtml(c.subject)}</li>`)
    .join("");
  return [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
    "<title>Cohort review and audit</title></head><body>",
    "<h1>Cohort review and audit</h1>",
    `<p>${escapeHtml(model.note)}</p>`,
    `<p>Generated ${escapeHtml(model.generatedAt)} from git.</p>`,
    "<h2>Records by status</h2><table><tbody>",
    statusRows,
    "</tbody></table>",
    `<p>${model.records.length} record(s); ${model.counts.unreadable} unreadable.</p>`,
    `<h2>Writebacks</h2><p>${model.writebacks.commits} commit(s) by ${model.writebacks.contributors} contributor(s).</p>`,
    `<ul>${recent}</ul>`,
    "</body></html>",
  ].join("");
}

/** Pure request handler. Read-only and auth-gated; no method but GET is accepted. */
export async function handleRequest(
  method: string,
  path: string,
  headers: Record<string, string | undefined>,
  deps: ServerDeps,
): Promise<HttpResult> {
  if (method !== "GET") {
    return json(405, { error: "method not allowed", reason: "the dashboard is read-only" });
  }

  // Liveness only; it reveals no vault content, so it needs no auth.
  if (path === "/healthz") return { status: 200, contentType: "text/plain", body: "ok\n" };

  if (path !== "/" && path !== "/audit") return json(404, { error: "not found" });

  const auth = deps.authorize(headers);
  if (!auth.allowed) {
    if (path === "/") {
      return { status: 401, contentType: "text/html", body: `<!doctype html><p>Unauthorized: ${escapeHtml(auth.reason)}</p>\n` };
    }
    return json(401, { error: "unauthorized", reason: auth.reason });
  }

  const model = await deps.audit();
  if (path === "/audit") return json(200, model);
  return { status: 200, contentType: "text/html", body: `${renderDashboard(model)}\n` };
}

/** Thin http wrapper over the pure handler. */
export function createDashboardServer(deps: ServerDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const path = (req.url ?? "/").split("?", 1)[0] ?? "/";
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : v;
    handleRequest(method, path, headers, deps)
      .then((result) => {
        res.writeHead(result.status, { "content-type": result.contentType });
        res.end(result.body);
      })
      .catch(() => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end('{"error":"internal error"}\n');
      });
  });
}
