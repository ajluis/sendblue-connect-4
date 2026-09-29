import assert from "node:assert/strict";
import test from "node:test";
import { GAMEPIGEON, processInboundEvent, processInboundMove, startGame } from "../src/bot.js";
import { emptyBoard } from "../src/connect4.js";
import { parseGameUrl, toGameUrl } from "../src/gamepigeon-codec.js";
import { SessionStore } from "../src/session-store.js";

test("inbound yellow move produces a red App Card continuation", async () => {
  const session = {
    sessionIdentifier: "4388d741-5bb7-417b-b22c-74da37a5df67",
    originalHandle: "original-handle",
    botId: "BOT_ID",
    gameId: "GAME_ID",
    contactNumber: "+12025550101",
    sendblueNumber: "+12025550102",
  };
  const store = new SessionStore({ filePath: null, bootstrap: [session] });
  const calls = [];
  const sendblue = {
    async updateAppCard(handle, body) {
      calls.push({ handle, body });
      return { status: 202, payload: { message_handle: "reply-handle" } };
    },
  };
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
  const event = {
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
  };

  const result = await processInboundMove(event, { store, sendblue, timeLimitMs: 20, maxDepth: 5 });
  assert.equal(result.action, "sent");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].handle, "original-handle");
  assert.match(calls[0].body.idempotency_key, /^gamepigeon-connect4-/);

  const outgoing = parseGameUrl(calls[0].body.url).fields;
  assert.equal(outgoing.get("sender"), "BOT_ID");
  assert.equal(outgoing.get("player"), "1");
  assert.equal(outgoing.get("player1"), "BOT_ID");
  assert.equal(outgoing.get("player2"), "USER_ID");
  assert.match(outgoing.get("replay"), /^board:0,0,0,0,2,0,0,/);
  assert.match(outgoing.get("replay"), /\|move:\d,[0-5],1$/);
});

test("starting a game stores the session and opens with a red center move", async () => {
  const store = new SessionStore({ filePath: null, bootstrap: [] });
  let outbound;
  const sendblue = {
    async sendInitialAppCard(body) {
      outbound = body;
      return {
        status: 202,
        payload: {
          status: "QUEUED",
          message_handle: "original-handle",
          app_card: { sessionIdentifier: "4388d741-5bb7-417b-b22c-74da37a5df67" },
        },
      };
    },
  };
  const result = await startGame({
    number: "+12025550101",
    fromNumber: "+12025550102",
    store,
    sendblue,
  });

  assert.equal(result.status, "QUEUED");
  assert.equal(store.size, 1);
  assert.equal(outbound.app_card.extensionBundleId, GAMEPIGEON.extensionBundleId);
  const invite = parseGameUrl(outbound.app_card.url).fields;
  assert.equal(invite.get("game"), "connect");
  assert.equal(invite.get("player"), "1");
  assert.match(invite.get("replay"), /\|move:3,0,1$/);
  assert.equal(outbound.app_card.layout.subcaption, "Red played column 4 — your move");
});

test("ordinary inbound on the testing line immediately starts a game", async () => {
  const store = new SessionStore({ filePath: null, bootstrap: [] });
  const sends = [];
  const sendblue = {
    async sendInitialAppCard(body) {
      sends.push(body);
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
  const result = await processInboundEvent({
    status: "RECEIVED",
    is_outbound: false,
    message_handle: "ordinary-inbound",
    from_number: "+12025550103",
    sendblue_number: "+12025550102",
    service: "iMessage",
    group_id: "",
    opted_out: false,
  }, {
    store,
    sendblue,
    testingLine: "+12025550102",
  });

  assert.equal(result.action, "invited");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].number, "+12025550103");
  assert.equal(sends[0].from_number, "+12025550102");
  const invite = parseGameUrl(sends[0].app_card.url).fields;
  assert.equal(invite.get("player"), "1");
  assert.match(invite.get("replay"), /\|move:3,0,1$/);
  assert.equal(store.size, 1);
});

test("inbound on another Sendblue line is ignored", async () => {
  const store = new SessionStore({ filePath: null, bootstrap: [] });
  let sends = 0;
  const sendblue = { async sendInitialAppCard() { sends += 1; } };
  const result = await processInboundEvent({
    status: "RECEIVED",
    is_outbound: false,
    message_handle: "other-line-inbound",
    from_number: "+12025550103",
    sendblue_number: "+12025550104",
  }, {
    store,
    sendblue,
    testingLine: "+12025550102",
  });

  assert.deepEqual(result, { action: "ignored", reason: "different_line" });
  assert.equal(sends, 0);
});
