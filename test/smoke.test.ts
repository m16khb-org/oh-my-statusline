import { describe, expect, test } from "bun:test";
import { VERSION } from "../src/index.ts";

describe("scaffold", () => {
  test("version is exported", () => {
    expect(typeof VERSION).toBe("string");
  });
});
