import "server-only";

// Keyset pagination's cursor, ported from template-go-nextjs platform/httpx/cursor.go: the 16 bytes of the last id on
// a page, in unpadded base64url. Clients pass it back unchanged and never build or parse one.

export function encodeCursor(id: string): string {
  return Buffer.from(id.replaceAll("-", ""), "hex").toString("base64url");
}

// The id a cursor from encodeCursor holds, or null for anything else. Node's base64url decoder skips characters it
// does not know and accepts padding and the standard alphabet, so a cursor counts only when it is exactly what
// encodeCursor makes of the bytes it decodes to.
export function decodeCursor(cursor: string): string | null {
  const bytes = Buffer.from(cursor, "base64url");
  if (bytes.length !== 16 || bytes.toString("base64url") !== cursor) {
    return null;
  }
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
