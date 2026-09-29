import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPendingMove,
  chooseMove,
  emptyBoard,
  landingRow,
  play,
  winner,
} from "../src/connect4.js";

test("wire rows are bottom-origin and pieces stack upward", () => {
  let board = emptyBoard();
  assert.equal(landingRow(board, 3), 0);
  board = play(board, 3, 1).board;
  assert.equal(landingRow(board, 3), 1);
  board = applyPendingMove(board, { col: 3, row: 1, player: 2 });
  assert.equal(board[3], 1);
  assert.equal(board[10], 2);
});

test("engine takes an immediate win", () => {
  let board = emptyBoard();
  for (const col of [0, 1, 2]) board = play(board, col, 1).board;
  const move = chooseMove(board, 1, { timeLimitMs: 20 });
  assert.equal(move.col, 3);
  assert.equal(winner(play(board, move.col, 1).board), 1);
});

test("engine blocks an immediate loss", () => {
  let board = emptyBoard();
  for (let index = 0; index < 3; index += 1) board = play(board, 5, 2).board;
  const move = chooseMove(board, 1, { timeLimitMs: 20 });
  assert.equal(move.col, 5);
});
