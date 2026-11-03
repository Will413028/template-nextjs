import type { KnipConfig } from "knip";

const config: KnipConfig = {
  // Run outside Next.js: the compose migrate service and drizzle-kit.
  entry: ["scripts/migrate.mts"],
  ignore: ["docs/**"],
  compilers: {
    css: (text: string) =>
      [...text.matchAll(/@(?:import|plugin)\s+["']?([^;\s"']+)/g)]
        .map(([, specifier]) => `import "${specifier}";`)
        .join("\n"),
  },
};

export default config;
