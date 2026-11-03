// Values safe in any bundle. Next.js inlines NODE_ENV only for a literal `process.env.NODE_ENV` read; server
// configuration (database, secrets) lives in src/server/env.ts, which client code cannot import.
export const isDevelopment = () => process.env.NODE_ENV === "development";
