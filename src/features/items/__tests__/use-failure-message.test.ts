import { describe, expect, it, vi } from "vitest";

// The translator returns the key and the values it got, so the test sees which codes are given the limit.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const { useFieldMessage } = await import("../components/use-failure-message");

describe("useFieldMessage", () => {
  it("names the limit for too_long only", () => {
    const message = useFieldMessage();
    expect(message("too_long")).toBe('too_long {"max":200}');
    expect(message("required")).toBe("required");
  });
});
