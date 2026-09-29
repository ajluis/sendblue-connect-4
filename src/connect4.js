export const COLS = 7;
export const ROWS = 6;
export const CELL_COUNT = COLS * ROWS;
const MOVE_ORDER = [3, 2, 4, 1, 5, 0, 6];
const TIMEOUT = Symbol("search-timeout");

export function emptyBoard() {
  return Array(CELL_COUNT).fill(0);
}

export function parseReplay(replay) {
  if (typeof replay !== "string") throw new Error("replay must be a string");
  let board = null;
  let move = null;

  for (const part of replay.split("|")) {
    if (part.startsWith("board:")) {
      board = part.slice(6).split(",").map((value) => Number.parseInt(value, 10));
    } else if (part.startsWith("move:")) {
      const values = part.slice(5).split(",").map((value) => Number.parseInt(value, 10));
      if (values.length === 3) move = { col: values[0], row: values[1], player: values[2] };
    }
  }

  validateBoard(board);
  if (!move || !Number.isInteger(move.col) || !Number.isInteger(move.row) || ![1, 2].includes(move.player)) {
    throw new Error("replay is missing a valid move");
  }
  if (move.col < 0 || move.col >= COLS || move.row < 0 || move.row >= ROWS) {
    throw new Error("move is outside the board");
  }
  return { board, move };
}

export function buildReplay(board, move) {
  validateBoard(board);
  if (!move || ![1, 2].includes(move.player)) throw new Error("invalid move");
  return `board:${board.join(",")}|move:${move.col},${move.row},${move.player}`;
}

export function validateBoard(board) {
  if (!Array.isArray(board) || board.length !== CELL_COUNT) {
    throw new Error(`board must contain ${CELL_COUNT} cells`);
  }
  if (board.some((cell) => !Number.isInteger(cell) || cell < 0 || cell > 2)) {
    throw new Error("board contains an invalid cell");
  }
}

// GamePigeon uses bottom-origin wire rows: row 0 is the bottom of the board.
export function landingRow(board, col) {
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return -1;
  for (let row = 0; row < ROWS; row += 1) {
    if (board[row * COLS + col] === 0) return row;
  }
  return -1;
}

export function legalMoves(board) {
  return MOVE_ORDER.filter((col) => landingRow(board, col) >= 0);
}

export function play(board, col, player) {
  const row = landingRow(board, col);
  if (row < 0) throw new Error(`column ${col + 1} is full`);
  const result = board.slice();
  result[row * COLS + col] = player;
  return { board: result, row };
}

export function applyPendingMove(board, move) {
  validateBoard(board);
  const expectedRow = landingRow(board, move.col);
  if (expectedRow < 0 || move.row !== expectedRow) {
    throw new Error(`illegal pending move at column ${move.col}, row ${move.row}`);
  }
  if (![1, 2].includes(move.player)) throw new Error("invalid pending player");
  const result = board.slice();
  result[move.row * COLS + move.col] = move.player;
  return result;
}

function at(board, row, col) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return 0;
  return board[row * COLS + col];
}

export function winner(board) {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const player = at(board, row, col);
      if (player === 0) continue;
      for (const [rowStep, colStep] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        let length = 1;
        for (let offset = 1; offset < 4; offset += 1) {
          if (at(board, row + rowStep * offset, col + colStep * offset) !== player) break;
          length += 1;
        }
        if (length === 4) return player;
      }
    }
  }
  return 0;
}

function evaluateWindow(values, bot, opponent) {
  const botCount = values.filter((cell) => cell === bot).length;
  const opponentCount = values.filter((cell) => cell === opponent).length;
  const emptyCount = 4 - botCount - opponentCount;
  if (botCount && opponentCount) return 0;
  if (botCount === 4) return 1_000_000;
  if (opponentCount === 4) return -1_000_000;
  if (botCount === 3 && emptyCount === 1) return 110;
  if (botCount === 2 && emptyCount === 2) return 14;
  if (botCount === 1 && emptyCount === 3) return 2;
  if (opponentCount === 3 && emptyCount === 1) return -125;
  if (opponentCount === 2 && emptyCount === 2) return -16;
  if (opponentCount === 1 && emptyCount === 3) return -2;
  return 0;
}

function evaluate(board, bot) {
  const opponent = 3 - bot;
  let score = 0;
  for (let row = 0; row < ROWS; row += 1) {
    if (at(board, row, 3) === bot) score += 7;
    if (at(board, row, 3) === opponent) score -= 7;
  }
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      for (const [rowStep, colStep] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const endRow = row + rowStep * 3;
        const endCol = col + colStep * 3;
        if (endRow < 0 || endRow >= ROWS || endCol < 0 || endCol >= COLS) continue;
        const values = Array.from({ length: 4 }, (_, index) =>
          at(board, row + rowStep * index, col + colStep * index),
        );
        score += evaluateWindow(values, bot, opponent);
      }
    }
  }
  return score;
}

function search(board, depth, alpha, beta, maximizing, bot, deadline, stats, table) {
  stats.nodes += 1;
  if ((stats.nodes & 255) === 0 && performance.now() >= deadline) throw TIMEOUT;

  const boardWinner = winner(board);
  if (boardWinner === bot) return 1_000_000 + depth;
  if (boardWinner === 3 - bot) return -1_000_000 - depth;
  const moves = legalMoves(board);
  if (depth === 0 || moves.length === 0) return evaluate(board, bot);

  const key = `${board.join("")}:${depth}:${maximizing ? 1 : 0}`;
  if (table.has(key)) return table.get(key);

  let value = maximizing ? -Infinity : Infinity;
  let cutOff = false;
  for (const col of moves) {
    const child = play(board, col, maximizing ? bot : 3 - bot).board;
    const score = search(child, depth - 1, alpha, beta, !maximizing, bot, deadline, stats, table);
    if (maximizing) {
      value = Math.max(value, score);
      alpha = Math.max(alpha, value);
    } else {
      value = Math.min(value, score);
      beta = Math.min(beta, value);
    }
    if (beta <= alpha) {
      cutOff = true;
      break;
    }
  }
  if (!cutOff) table.set(key, value);
  return value;
}

export function chooseMove(board, bot = 1, options = {}) {
  validateBoard(board);
  const start = performance.now();
  const timeLimitMs = Math.max(5, Number(options.timeLimitMs ?? 50));
  const maxDepth = Math.max(1, Number(options.maxDepth ?? 10));
  const deadline = start + timeLimitMs;
  const moves = legalMoves(board);
  if (moves.length === 0) throw new Error("no legal moves remain");

  for (const col of moves) {
    if (winner(play(board, col, bot).board) === bot) {
      return { col, score: 1_000_000, depth: 1, nodes: moves.length, elapsedMs: performance.now() - start };
    }
  }

  const threats = moves.filter((col) => winner(play(board, col, 3 - bot).board) === 3 - bot);
  if (threats.length === 1) {
    return { col: threats[0], score: 0, depth: 1, nodes: moves.length * 2, elapsedMs: performance.now() - start };
  }

  let bestCol = moves[0];
  let bestScore = -Infinity;
  let completedDepth = 0;
  const stats = { nodes: 0 };
  const table = new Map();

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let iterationCol = bestCol;
    let iterationScore = -Infinity;
    const ordered = [bestCol, ...moves.filter((col) => col !== bestCol)];
    try {
      for (const col of ordered) {
        if (performance.now() >= deadline) throw TIMEOUT;
        const child = play(board, col, bot).board;
        const score = search(child, depth - 1, -Infinity, Infinity, false, bot, deadline, stats, table);
        if (score > iterationScore) {
          iterationScore = score;
          iterationCol = col;
        }
      }
      bestCol = iterationCol;
      bestScore = iterationScore;
      completedDepth = depth;
      if (bestScore >= 1_000_000) break;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }

  return {
    col: bestCol,
    score: bestScore,
    depth: completedDepth,
    nodes: stats.nodes,
    elapsedMs: performance.now() - start,
  };
}
