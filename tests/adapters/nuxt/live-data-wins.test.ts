import { describe, expect, test } from "vite-plus/test";
import { liveDataWins } from "../../../src/adapters/nuxt/live-data.ts";

describe("liveDataWins", () => {
  test("live data takes over from the SSR payload at cached, complete, or error", () => {
    expect(liveDataWins("cached")).toBe(true);
    expect(liveDataWins("complete")).toBe(true);
    expect(liveDataWins("error")).toBe(true);
  });

  test("the SSR payload stays while the live resource has no result", () => {
    expect(liveDataWins("unknown")).toBe(false);
    expect(liveDataWins("disabled")).toBe(false);
  });
});
