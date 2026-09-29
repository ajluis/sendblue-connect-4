import assert from "node:assert/strict";
import test from "node:test";
import { GAMEPIGEON } from "../src/bot.js";
import { emptyBoard } from "../src/connect4.js";
import { toGameUrl } from "../src/gamepigeon-codec.js";
import { createApp } from "../src/server.js";
import { SessionStore } from "../src/session-store.js";

test("webhook acknowledges immediately and processes the move asynchronously", async (context) => {
  const session = {
    sessionIdentifier: "4388d741-5bb7-417b-b22c-74da37a5df67",
    originalHandle: "original-handle",
    botId: "BOT_ID",
    gameId: "GAME_ID",
    contactNumber: "+12025550101",
    sendblueNumber: "+12025550102",
  };
  const store = new SessionStore({ filePath: null, bootstrap: [session] });
  let resolveUpdate;
  const updated = new Promise((resolve) => { resolveUpdate = resolve; });
  const sendblue = {
    async updateAppCard(handle, body) {
      resolveUpdate({ handle, body });
      return { status: 202, payload: { message_handle: "reply-handle" } };
    },
  };
  const config = {
    port: 0,
    apiKey: "key",
    apiSecret: "secret",
    fromNumber: session.sendblueNumber,
    webhookToken: "test-token",
    adminToken: "admin-token",
    timeLimitMs: 10,
    maxDepth: 4,
    sessionsPath: null,
    bootstrapSessions: [],
  };
  const { server } = createApp({ config, sendblue, store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const port = server.address().port;

  const fields = new Map([
    ["game", "connect"],
    ["id", "GAME_ID"],
    ["sender", "USER_ID"],
    ["player", "2"],
    ["player1", "BOT_ID"],
    ["player2", "USER_ID"],
    ["num", "2"],
    ["replay", `board:${emptyBoard().join(",")}|move:4,0,2`],
  ]);
  const response = await fetch(`http://127.0.0.1:${port}/webhooks/sendblue/test-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "RECEIVED",
      is_outbound: false,
      message_handle: "inbound-handle",
      from_number: session.contactNumber,
      sendblue_number: session.sendblueNumber,
      app_card: {
        ...GAMEPIGEON,
        sessionIdentifier: session.sessionIdentifier,
        url: toGameUrl(fields),
      },
    }),
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  const call = await Promise.race([
    updated,
    new Promise((_, reject) => setTimeout(() => reject(new Error("move was not processed")), 1_000)),
  ]);
  assert.equal(call.handle, "original-handle");
});

test("webhook turns an ordinary inbound message into a game invitation", async (context) => {
  const store = new SessionStore({ filePath: null, bootstrap: [] });
  let resolveSend;
  const sent = new Promise((resolve) => { resolveSend = resolve; });
  const sendblue = {
    async sendInitialAppCard(body) {
      resolveSend(body);
      return {
        status: 202,
        payload: {
          status: "QUEUED",
          message_handle: "new-original-handle",
          app_card: { sessionIdentifier: "ca8f75dc-a522-4ce9-a4a7-e14293411aee" },
        },
      };
    },
  };
  const config = {
    port: 0,
    apiKey: "key",
    apiSecret: "secret",
    fromNumber: "+12025550102",
    webhookToken: "test-token",
    adminToken: "admin-token",
    timeLimitMs: 10,
    maxDepth: 4,
    sessionsPath: null,
    bootstrapSessions: [],
  };
  const { server } = createApp({ config, sendblue, store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const port = server.address().port;

  const response = await fetch(`http://127.0.0.1:${port}/webhooks/sendblue/test-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "RECEIVED",
      is_outbound: false,
      message_handle: "ordinary-inbound",
      from_number: "+12025550103",
      sendblue_number: "+12025550102",
      service: "iMessage",
      group_id: "",
      opted_out: false,
    }),
  });

  assert.equal(response.status, 202);
  const invitation = await Promise.race([
    sent,
    new Promise((_, reject) => setTimeout(() => reject(new Error("invitation was not sent")), 1_000)),
  ]);
  assert.equal(invitation.number, "+12025550103");
  assert.equal(invitation.from_number, "+12025550102");
});
