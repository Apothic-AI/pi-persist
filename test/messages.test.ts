import { afterEach, describe, expect, test } from "bun:test";
import {
	appendTrailingMessage,
	clearEnvMessages,
	collectMessages,
	getMessageRegistry,
	MESSAGE_REGISTRY_PROTOCOL,
	MESSAGE_REGISTRY_SYMBOL,
	MESSAGE_REGISTRY_VERSION,
	payloadArrayKey,
	registerEnvMessage,
	supportsTrailingMessage,
} from "../src/messages.ts";

const context = {
	provider: "subrouter",
	activeTools: ["read", "bash"],
	cwd: "/home/u/project",
	mode: "tui",
};

afterEach(() => {
	clearEnvMessages();
	delete (globalThis as Record<symbol, unknown>)[MESSAGE_REGISTRY_SYMBOL];
});

describe("message registry", () => {
	test("is versioned", () => {
		expect(getMessageRegistry()?.protocol).toBe(MESSAGE_REGISTRY_PROTOCOL);
		expect(getMessageRegistry()?.version).toBe(MESSAGE_REGISTRY_VERSION);
	});

	test("rejects an empty id", () => {
		expect(() => registerEnvMessage({ id: "", content: "x" })).toThrow(/non-empty id/);
	});

	test("unregister removes only its own entry", () => {
		const unregister = registerEnvMessage({ id: "clock", content: "first" });
		registerEnvMessage({ id: "clock", content: "second" });
		unregister();
		expect(collectMessages(context)).toEqual(["second"]);
	});
});

describe("collectMessages", () => {
	test("orders by priority then id and drops empty bodies", () => {
		registerEnvMessage({ id: "b", priority: 1, content: "b" });
		registerEnvMessage({ id: "a", priority: 1, content: "a" });
		registerEnvMessage({ id: "blank", content: "   " });
		expect(collectMessages(context)).toEqual(["a", "b"]);
	});

	test("filters on provider and active tools", () => {
		registerEnvMessage({ id: "p", providers: ["openrouter"], content: "provider-gated" });
		registerEnvMessage({ id: "t", activeTools: ["grep"], content: "tool-gated" });
		registerEnvMessage({ id: "ok", content: "visible" });
		expect(collectMessages(context)).toEqual(["visible"]);
	});

	test("a throwing body is skipped", () => {
		registerEnvMessage({
			id: "bad",
			content: () => {
				throw new Error("boom");
			},
		});
		registerEnvMessage({ id: "good", content: "ok" });
		expect(collectMessages(context)).toEqual(["ok"]);
	});
});

describe("payload shape detection", () => {
	test("completions payloads expose messages", () => {
		expect(payloadArrayKey({ messages: [] })).toBe("messages");
	});

	test("responses payloads expose input", () => {
		// Measured against OpenRouter's /responses endpoint: the payload carries `input`, not `messages`.
		expect(payloadArrayKey({ input: [] })).toBe("input");
	});

	test("prefers messages when both exist", () => {
		expect(payloadArrayKey({ messages: [], input: [] })).toBe("messages");
	});

	test("returns undefined for an unknown shape rather than guessing", () => {
		expect(payloadArrayKey({ foo: [] })).toBeUndefined();
		expect(payloadArrayKey(undefined)).toBeUndefined();
		expect(payloadArrayKey("nope")).toBeUndefined();
		expect(supportsTrailingMessage({ foo: [] })).toBe(false);
	});
});

describe("appendTrailingMessage", () => {
	test("appends a developer message to a completions payload", () => {
		registerEnvMessage({ id: "clock", content: "12:00" });
		const payload: { messages: Array<{ role: string; content: unknown }> } = {
			messages: [{ role: "user", content: "hi" }],
		};
		appendTrailingMessage(payload, context, "subrouter");
		expect(payload.messages).toHaveLength(2);
		expect(payload.messages[1]).toEqual({ role: "developer", content: "12:00" });
	});

	test("wraps responses-API content in input_text blocks", () => {
		registerEnvMessage({ id: "clock", content: "12:00" });
		const payload: { input: Array<{ role: string; content: unknown }> } = {
			input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
		};
		appendTrailingMessage(payload, context, "orresp");
		expect(payload.input[1]).toEqual({
			role: "developer",
			content: [{ type: "input_text", text: "12:00" }],
		});
	});

	test("appends after the final tool result, which is the point of the channel", () => {
		registerEnvMessage({ id: "clock", content: "12:00" });
		const payload = {
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "" },
				{ role: "tool", content: "result" },
			],
		};
		appendTrailingMessage(payload, context, "subrouter");
		expect(payload.messages.at(-1)).toEqual({ role: "developer", content: "12:00" });
		expect(payload.messages).toHaveLength(4);
	});

	test("folds several contributions into one trailing message", () => {
		registerEnvMessage({ id: "b", content: "second" });
		registerEnvMessage({ id: "a", content: "first" });
		const payload = { messages: [] as Array<{ role: string; content: unknown }> };
		appendTrailingMessage(payload, context, "subrouter");
		expect(payload.messages).toHaveLength(1);
		expect(payload.messages[0]?.content).toBe("first\nsecond");
	});

	test("leaves the payload untouched when nothing resolves", () => {
		const payload = { messages: [{ role: "user", content: "hi" }] };
		appendTrailingMessage(payload, context, "subrouter");
		expect(payload.messages).toHaveLength(1);
	});

	test("leaves an unknown payload shape untouched", () => {
		registerEnvMessage({ id: "clock", content: "12:00" });
		const payload = { somethingElse: [] as unknown[] };
		expect(appendTrailingMessage(payload, context, "subrouter")).toBe(payload);
		expect(payload.somethingElse).toHaveLength(0);
	});

	test("is idempotent per payload, so repeated requests each get their own copy", () => {
		registerEnvMessage({ id: "clock", content: "12:00" });
		const first = { messages: [] as Array<{ role: string; content: unknown }> };
		const second = { messages: [] as Array<{ role: string; content: unknown }> };
		appendTrailingMessage(first, context, "subrouter");
		appendTrailingMessage(second, context, "subrouter");
		expect(first.messages).toHaveLength(1);
		expect(second.messages).toHaveLength(1);
	});
});
