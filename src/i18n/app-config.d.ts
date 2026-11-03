import type messages from "../../messages/en.json";
import type { routing } from "./routing";

// next-intl checks every message key against the default locale's catalog at compile time: a key a component asks for,
// an error code included, that en.json lacks fails `tsc`; messages.test.ts checks the other locales have the same
// keys.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
