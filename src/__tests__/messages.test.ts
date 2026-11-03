import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import en from "../../messages/en.json";
import zhTW from "../../messages/zh-TW.json";

const catalogs: Record<string, object> = { en, "zh-TW": zhTW };

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "object" && child !== null
      ? keys(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("messages", () => {
  it("has a catalog for every locale", () => {
    expect(Object.keys(catalogs).sort()).toEqual([...routing.locales].sort());
  });

  it.each(routing.locales.filter((l) => l !== routing.defaultLocale))(
    "%s has exactly the default locale's keys",
    (locale) => {
      const catalog = catalogs[locale] ?? {};
      expect(keys(catalog).sort()).toEqual(keys(en).sort());
    },
  );
});
