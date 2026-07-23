import { describe, expect, it } from "vitest";
import { configPackageReady } from "../src/index.js";

describe("@easytree/config placeholder", () => {
  it("exposes the pipeline readiness flag", () => {
    expect(configPackageReady).toBe(true);
  });
});
