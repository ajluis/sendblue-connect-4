import assert from "node:assert/strict";
import test from "node:test";
import { parseGameUrl, toGameUrl } from "../src/gamepigeon-codec.js";

test("GamePigeon codec round-trips fields and replay separators", () => {
  const fields = new Map([
    ["game", "connect"],
    ["sender", "BOT_123"],
    ["replay", `board:${Array(42).fill(0).join(",")}|move:3,0,1`],
    ["caption", "Let's%20play!"],
  ]);
  const url = toGameUrl(fields, 52);
  assert.match(url, /^data:\?ver=52&data=/);
  const decoded = parseGameUrl(url);
  assert.equal(decoded.version, 52);
  assert.deepEqual([...decoded.fields], [...fields]);
});
