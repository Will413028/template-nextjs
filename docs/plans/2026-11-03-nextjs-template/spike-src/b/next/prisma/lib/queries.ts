import type { PrismaClient } from "./generated/prisma/client.ts";
// Keyset page of one owner's items, newest first. Option 1: plain where/orderBy/take (same shape as the Drizzle one).
export function listItems(db: PrismaClient, ownerId: string, limit: number, after?: string) {
  return db.item.findMany({
    select: { id: true, title: true, createdAt: true },
    where: { ownerId, ...(after ? { id: { lt: after } } : {}) },
    orderBy: { id: "desc" },
    take: limit,
  });
}
// Option 2: Prisma's built-in cursor pagination (documented approach).
export function listItemsCursor(db: PrismaClient, ownerId: string, limit: number, after?: string) {
  return db.item.findMany({
    select: { id: true, title: true, createdAt: true },
    where: { ownerId },
    orderBy: { id: "desc" },
    take: limit,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
  });
}
