import "server-only";

// Stand-in for the database: side effects the tests assert on ("did the action run?").
type Store = {
  effects: { action: string; tag: string; at: number }[];
  users: Map<string, { account: string; hash: string }>;
  sessions: Map<string, { account: string; createdAt: number }>; // key = sha256(token) hex
};
const g = globalThis as unknown as { __spike?: Store };
export const store: Store = (g.__spike ??= { effects: [], users: new Map(), sessions: new Map() });

export function record(action: string, tag: string) {
  store.effects.push({ action, tag, at: Date.now() });
}
