import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

// Every date and time is shown in this IANA time zone. Without one next-intl uses the server process's own zone (TZ;
// it warns only in development), and a client component formatting in the browser's zone would disagree with the
// server's HTML. A derived project whose users share a zone sets it here (e.g. "Asia/Taipei").
const TIME_ZONE = "UTC";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    timeZone: TIME_ZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
