import { createServer } from "node:http";
import { resolve } from "node:path";
import { processInboundEvent, startGame } from "./bot.js";
import { SendblueClient } from "./sendblue.js";
import { SessionStore } from "./session-store.js";

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error.message}`);
  }
}

export function loadConfig() {
  const dataDir = resolve(process.env.DATA_DIR || "./data");
  return {
    port: Number.parseInt(process.env.PORT || "3000", 10),
    apiKey: process.env.SENDBLUE_API_KEY || "",
    apiSecret: process.env.SENDBLUE_API_SECRET || "",
    fromNumber: process.env.SENDBLUE_FROM_NUMBER || "",
    webhookToken: process.env.WEBHOOK_TOKEN || "dev-webhook-token",
    adminToken: process.env.ADMIN_TOKEN || "",
    timeLimitMs: Number.parseInt(process.env.MOVE_TIME_LIMIT_MS || "50", 10),
    maxDepth: Number.parseInt(process.env.MOVE_MAX_DEPTH || "10", 10),
    sessionsPath: resolve(dataDir, "sessions.json"),
    bootstrapSessions: parseJsonEnv("BOOTSTRAP_SESSIONS_JSON", []),
  };
}

function log(level, message, details = {}) {
  console.log(JSON.stringify({ level, message, at: new Date().toISOString(), ...details }));
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readJson(request, maximumBytes = 65_536) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function authorized(request, token) {
  return Boolean(token && request.headers.authorization === `Bearer ${token}`);
}

function dashboard(sessionCount, ready, testingLine) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gamepigeon Demo</title><style>body{margin:0;background:#07111f;color:#eaf2ff;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{max-width:620px;padding:40px;border:1px solid #22344e;border-radius:22px;background:#0d1a2c;box-shadow:0 20px 70px #0008}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:${ready ? "#39d98a" : "#ffbc42"};margin-right:8px}h1{margin:.2em 0;font-size:clamp(28px,6vw,48px)}p{line-height:1.6;color:#a9bad2}.stat{display:inline-block;padding:8px 12px;border-radius:999px;background:#13243a;color:#cfe1fb}</style></head><body><main class="card"><div><span class="dot"></span>${ready ? "Ready" : "Configuration needed"}</div><h1>Gamepigeon Demo</h1><p>Every direct inbound message to ${testingLine || "the configured testing line"} starts a Connect Four invitation. Game moves are answered by the local deterministic engine.</p><span class="stat">${sessionCount} active session${sessionCount === 1 ? "" : "s"}</span></main></body></html>`;
}

export function createApp({ config = loadConfig(), sendblue: providedClient, store: providedStore } = {}) {
  const sendblue = providedClient ?? new SendblueClient({ apiKey: config.apiKey, apiSecret: config.apiSecret });
  const store = providedStore ?? new SessionStore({ filePath: config.sessionsPath, bootstrap: config.bootstrapSessions });
  const jobs = new Map();
  const handled = new Map();

  function queueEvent(event) {
    const handle = event?.message_handle;
    if (!handle || handled.has(handle)) return;
    handled.set(handle, Date.now());
    if (handled.size > 2_000) handled.delete(handled.keys().next().value);

    const jobKey = event?.app_card?.sessionIdentifier || `${event?.sendblue_number || "unknown"}:${event?.from_number || "unknown"}`;
    const previous = jobs.get(jobKey) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const started = performance.now();
        const result = await processInboundEvent(event, {
          store,
          sendblue,
          testingLine: config.fromNumber,
          timeLimitMs: config.timeLimitMs,
          maxDepth: config.maxDepth,
        });
        log("info", "inbound event processed", {
          handle,
          jobKey,
          action: result.action,
          column: result.column,
          searchMs: result.search ? Number(result.search.elapsedMs.toFixed(2)) : undefined,
          totalMs: Number((performance.now() - started).toFixed(2)),
        });
      })
      .catch((error) => {
        handled.delete(handle);
        log("error", "inbound move failed", {
          handle,
          jobKey,
          error: error.message,
          sendblueStatus: error.status,
        });
      })
      .finally(() => {
        if (jobs.get(jobKey) === current) jobs.delete(jobKey);
      });
    jobs.set(jobKey, current);
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const ready = Boolean(config.apiKey && config.apiSecret && config.webhookToken);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        const body = dashboard(store.size, ready, config.fromNumber);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body) });
        response.end(body);
        return;
      }

      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, ready ? 200 : 503, { ok: ready, sessions: store.size });
        return;
      }

      if (request.method === "POST" && url.pathname === `/webhooks/sendblue/${config.webhookToken}`) {
        const event = await readJson(request);
        sendJson(response, 202, { accepted: true });
        setImmediate(() => queueEvent(event));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/status") {
        if (!authorized(request, config.adminToken)) return sendJson(response, 401, { error: "unauthorized" });
        sendJson(response, 200, { ok: true, sessions: store.listPublic(), activeJobs: jobs.size });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/games/connect4/start") {
        if (!authorized(request, config.adminToken)) return sendJson(response, 401, { error: "unauthorized" });
        const body = await readJson(request);
        const result = await startGame({
          number: body.number,
          fromNumber: body.from_number || config.fromNumber,
          store,
          sendblue,
        });
        sendJson(response, 202, {
          status: result.status,
          sessionIdentifier: result.session.sessionIdentifier,
          number: result.session.contactNumber,
        });
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      log("error", "request failed", { path: url.pathname, error: error.message });
      sendJson(response, 400, { error: error.message });
    }
  });

  return { server, store, sendblue, queueEvent };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const { server, store } = createApp({ config });
  server.listen(config.port, "0.0.0.0", () => {
    log("info", "server listening", { port: config.port, sessions: store.size });
  });
}
