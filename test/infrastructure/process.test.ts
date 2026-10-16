import { expect, test } from "bun:test";
import { run } from "../../src/infrastructure/process.ts";

test("stdout on exit 0", async () => {
	expect(await run(["echo", "hi"])).toBe("hi\n");
});
test("stdin is passed", async () => {
	expect(await run(["cat"], { stdin: "abc" })).toBe("abc");
});
test("non-zero exit, missing binary and timeout give null", async () => {
	expect(await run(["false"])).toBeNull();
	expect(await run(["definitely-not-a-binary-xyz"])).toBeNull();
	expect(await run(["sleep", "5"], { timeoutMs: 100 })).toBeNull();
});
