import { describe, expect, test } from "bun:test";
import { isValidItemId, parseItemsFile } from "../src/items.ts";

describe("items file parsing", () => {
	test("accepts a well-formed file", () => {
		const { items, errors } = parseItemsFile(
			JSON.stringify({ version: 1, items: [{ id: "a", channel: "trailing", content: "x" }] }),
		);
		expect(errors).toEqual([]);
		expect(items).toEqual([{ id: "a", channel: "trailing", content: "x" }]);
	});

	test("preserves optional policy fields", () => {
		const { items } = parseItemsFile(
			JSON.stringify({
				items: [{ id: "a", channel: "section", content: "x", priority: 3, providers: ["p"], activeTools: ["t"] }],
			}),
		);
		expect(items[0]).toEqual({
			id: "a",
			channel: "section",
			content: "x",
			priority: 3,
			providers: ["p"],
			activeTools: ["t"],
		});
	});

	test("skips bad entries but keeps the good ones", () => {
		const { items, errors } = parseItemsFile(
			JSON.stringify({
				items: [
					{ id: "ok", channel: "trailing", content: "keep" },
					{ id: "no-channel", content: "x" },
					{ channel: "trailing", content: "x" },
					{ id: "bad id", channel: "trailing", content: "x" },
					{ id: "no-content", channel: "trailing" },
					{ id: "ok", channel: "trailing", content: "dup" },
				],
			}),
		);
		expect(items.map((item) => item.content)).toEqual(["keep"]);
		expect(errors).toHaveLength(5);
	});

	test("same id in different channels is not a duplicate", () => {
		const { items, errors } = parseItemsFile(
			JSON.stringify({
				items: [
					{ id: "x", channel: "trailing", content: "t" },
					{ id: "x", channel: "section", content: "s" },
				],
			}),
		);
		expect(errors).toEqual([]);
		expect(items).toHaveLength(2);
	});

	test("malformed JSON and wrong shapes degrade instead of throwing", () => {
		expect(parseItemsFile("{ nope").errors[0]).toContain("not valid JSON");
		expect(parseItemsFile("[]").errors[0]).toContain("top level must be an object");
		expect(parseItemsFile(JSON.stringify({ items: {} })).errors[0]).toContain("items must be an array");
		expect(parseItemsFile(JSON.stringify({})).items).toEqual([]);
	});

	test("ignores non-string entries in policy lists", () => {
		const { items } = parseItemsFile(
			JSON.stringify({ items: [{ id: "a", channel: "trailing", content: "x", providers: ["p", 1, null] }] }),
		);
		expect(items[0]?.providers).toEqual(["p"]);
	});
});

describe("isValidItemId", () => {
	test("requires a leading letter", () => {
		expect(isValidItemId("clock")).toBe(true);
		expect(isValidItemId("my.item-1")).toBe(true);
		expect(isValidItemId("9lead")).toBe(false);
		expect(isValidItemId("has space")).toBe(false);
	});
});
