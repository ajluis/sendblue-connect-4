import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  applyPendingMove,
  buildReplay,
  chooseMove,
  emptyBoard,
  landingRow,
  legalMoves,
  parseReplay,
  winner,
} from "./connect4.js";
import { parseGameUrl, toGameUrl } from "./gamepigeon-codec.js";

export const GAMEPIGEON = {
  appName: "GamePigeon",
  appStoreId: 1124197642,
  extensionBundleId: "com.gamerdelights.gamepigeon.ext",
  teamId: "EWFNLB79LQ",
};

const AVATAR = "body,0%7Ceyes,0%7Cmouth,0%7Cacc,0%7Cwins,0%7Cbg_color,0.900000,0.900000,0.900000%7Cbody_color,0.000000,1.000000,0.000000%7Cglasses,0%7Cstache,0%7Cbackdrop,0%7Chair,1%7Cclothes,1%7Chair_color,0.345098,0.180392,0.125490%7Cclothes_color,0.686298,0.802478,0.084548";
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomId(length) {
  return Array.from(randomBytes(length), (value) => BASE62[value % BASE62.length]).join("");
}

export function isSupportedInbound(event) {
  return Boolean(
    event &&
      event.status === "RECEIVED" &&
      event.is_outbound === false &&
      event.message_handle &&
      event.app_card?.extensionBundleId === GAMEPIGEON.extensionBundleId &&
      event.app_card?.teamId === GAMEPIGEON.teamId &&
      event.app_card?.sessionIdentifier &&
      typeof event.app_card?.url === "string",
  );
}

export function isInboundMessage(event) {
  return Boolean(
    event &&
      event.status === "RECEIVED" &&
      event.is_outbound === false &&
      event.message_handle &&
      /^\+[1-9]\d{7,14}$/.test(event.from_number ?? "") &&
      /^\+[1-9]\d{7,14}$/.test(event.sendblue_number ?? ""),
  );
}

function idempotencyKey(messageHandle) {
  const digest = createHash("sha256").update(messageHandle).digest("hex").slice(0, 40);
  return `gamepigeon-connect4-${digest}`;
}

export async function processInboundMove(event, { store, sendblue, timeLimitMs = 50, maxDepth = 10 }) {
  if (!isSupportedInbound(event)) return { action: "ignored", reason: "unsupported_event" };
  const session = store.findForEvent(event);
  if (!session) return { action: "ignored", reason: "unknown_session" };

  const { version, fields } = parseGameUrl(event.app_card.url);
  if (fields.get("game") !== "connect") return { action: "ignored", reason: "not_connect4" };
  if (session.gameId && fields.get("id") !== session.gameId) {
    return { action: "ignored", reason: "game_id_mismatch" };
  }

  const opponentId = session.opponentId || fields.get("player2") || fields.get("sender");
  if (!opponentId || fields.get("sender") === session.botId) {
    return { action: "ignored", reason: "not_opponent_move" };
  }

  const state = parseReplay(fields.get("replay") ?? "");
  if (state.move.player !== 2) throw new Error("expected a yellow player-two move");
  const board = applyPendingMove(state.board, state.move);
  const userWinner = winner(board);
  if (userWinner || legalMoves(board).length === 0) {
    return { action: "finished", winner: userWinner, reason: userWinner ? "user_won" : "draw" };
  }

  const decision = chooseMove(board, 1, { timeLimitMs, maxDepth });
  const row = landingRow(board, decision.col);
  const nextFields = new Map(fields);
  nextFields.set("player1", session.botId);
  nextFields.set("player2", opponentId);
  nextFields.set("sender", session.botId);
  nextFields.set("player", "1");
  nextFields.set("num", String((Number.parseInt(fields.get("num") ?? "0", 10) || 0) + 1));
  nextFields.set("game", "connect");
  nextFields.set("size", "4");
  nextFields.set("replay", buildReplay(board, { col: decision.col, row, player: 1 }));

  const column = decision.col + 1;
  const fallback = `Red played column ${column}`;
  const result = await sendblue.updateAppCard(session.originalHandle, {
    url: toGameUrl(nextFields, version),
    interactive: true,
    fallback_text: fallback,
    layout: {
      caption: "Four in a Row",
      subcaption: `${fallback}. Your move.`,
    },
    idempotency_key: idempotencyKey(event.message_handle),
  });

  if (!session.opponentId) store.upsert({ ...session, opponentId });
  return {
    action: "sent",
    column,
    row,
    search: decision,
    httpStatus: result.status,
    messageHandle: result.payload?.message_handle ?? null,
  };
}

/**
 * Route a receive webhook for the dedicated demo line.
 * Existing Connect Four sessions continue normally; every other direct inbound
 * message starts a fresh invitation from the testing line.
 */
export async function processInboundEvent(
  event,
  { store, sendblue, testingLine, timeLimitMs = 50, maxDepth = 10 },
) {
  if (!isInboundMessage(event)) return { action: "ignored", reason: "unsupported_event" };
  if (event.sendblue_number !== testingLine) return { action: "ignored", reason: "different_line" };
  if (event.opted_out === true) return { action: "ignored", reason: "contact_opted_out" };
  if (event.group_id || (Array.isArray(event.participants) && event.participants.length > 2)) {
    return { action: "ignored", reason: "group_unsupported" };
  }

  if (isSupportedInbound(event)) {
    const moveResult = await processInboundMove(event, { store, sendblue, timeLimitMs, maxDepth });
    if (moveResult.action !== "ignored") return moveResult;
    if (!["unknown_session", "not_connect4", "game_id_mismatch"].includes(moveResult.reason)) {
      return moveResult;
    }
  }

  const result = await startGame({
    number: event.from_number,
    fromNumber: testingLine,
    store,
    sendblue,
  });
  return {
    action: "invited",
    status: result.status,
    sessionIdentifier: result.session.sessionIdentifier,
  };
}

export async function startGame({ number, fromNumber, store, sendblue }) {
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new Error("number must be in E.164 format");
  if (!/^\+[1-9]\d{7,14}$/.test(fromNumber)) throw new Error("from_number must be in E.164 format");

  const botId = `${randomUUID().toUpperCase()}${randomId(6)}`;
  const gameId = randomId(16);
  const fields = new Map([
    ["sender", botId],
    ["player1", botId],
    ["version", "0"],
    ["tver", "5"],
    ["ios", "1"],
    ["game", "connect"],
    ["id", gameId],
    ["size", "4"],
    ["player", "1"],
    ["avatar1", AVATAR],
    ["replay", buildReplay(emptyBoard(), { col: 3, row: 0, player: 1 })],
    ["num", "1"],
    ["build", "9999"],
  ]);

  // Send the invitation with red's opening disc as the pending move. GamePigeon
  // animates it into the bottom-center cell when the recipient opens the card.
  const response = await sendblue.sendInitialAppCard({
    number,
    from_number: fromNumber,
    app_card: {
      ...GAMEPIGEON,
      url: toGameUrl(fields),
      interactive: true,
      layout: {
        caption: "Four in a Row",
        subcaption: "Red played column 4 — your move",
        summary: "GamePigeon Four in a Row",
      },
    },
  });

  const sessionIdentifier = response.payload?.app_card?.sessionIdentifier;
  const originalHandle = response.payload?.message_handle;
  if (!sessionIdentifier || !originalHandle) throw new Error("Sendblue did not return App Card session metadata");
  const session = store.upsert({
    sessionIdentifier,
    originalHandle,
    botId,
    gameId,
    contactNumber: number,
    sendblueNumber: fromNumber,
    createdAt: new Date().toISOString(),
  });
  return { session, status: response.payload?.status ?? null };
}
