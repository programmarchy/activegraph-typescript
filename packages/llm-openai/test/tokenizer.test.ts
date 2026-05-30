import { describe, expect, it } from "vitest";

import { OpenAIProvider } from "../src/index.js";

describe("OpenAIProvider.countTokens", () => {
  it("uses gpt-tokenizer for accurate counts", () => {
    const p = new OpenAIProvider({ apiKey: "stub" });
    // "Hello, world!" is 4 tokens for cl100k_base / o200k_base.
    expect(p.countTokens("Hello, world!")).toBeGreaterThan(0);
    expect(p.countTokens("Hello, world!")).toBeLessThan(10);
    // Longer text should produce more tokens.
    expect(p.countTokens("Hello, world! ".repeat(100))).toBeGreaterThan(100);
  });
});
