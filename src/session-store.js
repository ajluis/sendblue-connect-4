import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function validateSession(session) {
  for (const field of ["sessionIdentifier", "originalHandle", "botId", "contactNumber", "sendblueNumber"]) {
    if (typeof session?.[field] !== "string" || !session[field]) {
      throw new Error(`session is missing ${field}`);
    }
  }
  return { ...session };
}

export class SessionStore {
  constructor({ filePath, bootstrap = [] }) {
    this.filePath = filePath;
    this.sessions = new Map();
    this.load();
    for (const session of bootstrap) this.upsert(session, { persist: false });
  }

  load() {
    if (!this.filePath || !existsSync(this.filePath)) return;
    const stored = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (!Array.isArray(stored)) throw new Error("sessions file must contain an array");
    for (const session of stored) {
      const valid = validateSession(session);
      this.sessions.set(valid.sessionIdentifier, valid);
    }
  }

  persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify([...this.sessions.values()], null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }

  upsert(session, { persist = true } = {}) {
    const valid = validateSession(session);
    const previous = this.sessions.get(valid.sessionIdentifier) ?? {};
    const merged = { ...previous, ...valid };
    this.sessions.set(merged.sessionIdentifier, merged);
    if (persist) this.persist();
    return merged;
  }

  findForEvent(event) {
    const session = this.sessions.get(event?.app_card?.sessionIdentifier);
    if (!session) return null;
    if (session.contactNumber !== event.from_number) return null;
    if (session.sendblueNumber !== event.sendblue_number) return null;
    return session;
  }

  listPublic() {
    return [...this.sessions.values()].map((session) => ({
      sessionIdentifier: session.sessionIdentifier,
      contactNumber: session.contactNumber,
      sendblueNumber: session.sendblueNumber,
      gameId: session.gameId ?? null,
      hasOpponent: Boolean(session.opponentId),
      createdAt: session.createdAt ?? null,
    }));
  }

  get size() {
    return this.sessions.size;
  }
}
