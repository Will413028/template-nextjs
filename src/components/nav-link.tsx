"use client";

import { Link, usePathname } from "@/i18n/navigation";

// A link in the app's top bar, marked as the current page when it is that page or one under it.
export function NavLink({
  href,
  children,
}: {
  href: "/dashboard" | "/items" | "/settings";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-sm transition-colors ${
        current
          ? "bg-surface text-foreground"
          : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
