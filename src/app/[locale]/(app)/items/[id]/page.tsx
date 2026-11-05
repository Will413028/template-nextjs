import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/features/auth/server";
import { DeleteItemButton, ItemForm } from "@/features/items";
import { getItem } from "@/features/items/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("items");
  return { title: t("editTitle") };
}

// One of the viewer's items, to change or delete. Another user's item, a deleted one and an id that is no UUID are
// all a page that does not exist (the Go template's API and auth ADR).
export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireSession();
  const item = await getItem(viewer, (await params).id);
  if (!item) notFound();
  const t = await getTranslations("items");
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Link
          href="/items"
          className="text-muted text-sm hover:text-foreground"
        >
          {t("back")}
        </Link>
        <h1 className="font-medium text-2xl">{t("editTitle")}</h1>
      </div>
      <section className="card">
        <ItemForm
          item={{
            id: item.id,
            title: item.title,
            description: item.description,
          }}
        />
      </section>
      <section className="flex flex-col items-start gap-2">
        <p className="text-muted text-sm">{t("deleteDescription")}</p>
        <DeleteItemButton id={item.id} />
      </section>
    </div>
  );
}
