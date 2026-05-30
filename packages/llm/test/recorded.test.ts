import { describe, expect, it } from "vitest";

import { RecordedLLMProvider, type RecordedExchange } from "../src/index.js";

describe("RecordedLLMProvider", () => {
  const exchanges: RecordedExchange[] = [
    {
      request: { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "ping" }] },
      response: {
        text: "pong",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.0001,
        latencySeconds: 0.05,
      },
    },
    {
      request: { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "again" }] },
      response: {
        text: "ok",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.0001,
        latencySeconds: 0.05,
      },
    },
  ];

  it("replays exchanges in order", async () => {
    const p = new RecordedLLMProvider(exchanges);
    const a = await p.complete({ model: "claude-sonnet-4-6", messages: [] });
    expect(a.text).toBe("pong");
    const b = await p.complete({ model: "claude-sonnet-4-6", messages: [] });
    expect(b.text).toBe("ok");
  });

  it("throws when the transcript is exhausted", async () => {
    const p = new RecordedLLMProvider([exchanges[0]!]);
    await p.complete({ model: "x", messages: [] });
    await expect(p.complete({ model: "x", messages: [] })).rejects.toThrow(/exhausted/);
  });

  it("reset() rewinds the cursor", async () => {
    const p = new RecordedLLMProvider(exchanges);
    await p.complete({ model: "x", messages: [] });
    p.reset();
    const a = await p.complete({ model: "x", messages: [] });
    expect(a.text).toBe("pong");
  });
});
