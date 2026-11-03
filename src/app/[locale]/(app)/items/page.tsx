import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireSession } from "@/features/auth/server";
import { ItemForm } from "@/features/items";
import { listItems } from "@/features/items/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("items");
  return { title: t("title") };
}

// The viewer's items, newest first, a page at a time: ?cursor= is the previous page's nextCursor, and a cursor this app
// did not make is a page that does not exist.
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const viewer = await requireSession();
  const { cursor } = await searchParams;
  const page = await listItems(viewer, cursor === undefined ? {} : { cursor });
  if (!page.ok) notFound();
  const t = await getTranslations("items");
  const format = await getFormatter();
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="mb-2 font-medium text-2xl">{t("title")}</h1>
        <p className="text-muted">{t("intro")}</p>
      </div>

      <section className="card flex flex-col gap-4">
        <h2 className="font-medium text-lg">{t("newItem")}</h2>
        <ItemForm />
      </section>

      {page.items.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
          {page.items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/items/${item.id}`}
                className="flex flex-col gap-1 px-5 py-4 hover:bg-surface"
              >
                <span className="font-medium">{item.title}</span>
                {item.description && (
                  <span className="line-clamp-2 text-muted text-sm">
                    {item.description}
                  </span>
                )}
                <span className="text-muted text-xs">
                  {t("updatedAt", {
                    at: format.dateTime(item.updatedAt, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    }),
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(cursor !== undefined || page.nextCursor) && (
        <nav aria-label={t("pagination")} className="flex gap-3">
          {cursor !== undefined && (
            <Link href="/items" className="btn-secondary">
              {t("firstPage")}
            </Link>
          )}
          {page.nextCursor && (
            <Link
              href={{ pathname: "/items", query: { cursor: page.nextCursor } }}
              className="btn-secondary"
            >
              {t("nextPage")}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
