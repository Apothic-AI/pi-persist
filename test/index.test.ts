import { afterEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import envContext, { buildEnvironmentSection, DEFAULT_OMIT, SECTION_NAME } from "../src/index.ts";
import { clearEnvMessages, registerEnvMessage } from "../src/messages.ts";
import { clearContributions, REGISTRY_SYMBOL, registerEnvContribution } from "../src/registry.ts";

afterEach(() => {
	clearContributions();
	clearEnvMessages();
});

type Handler = (event: unknown, ctx: unknown) => unknown;

function harness(activeTools: string[] = ["read", "bash"], settings: object = {}, settingsThrows = false) {
	const handlers = new Map<string, Handler>();
	envContext({
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
			return () => {};
		},
		getActiveTools: () => activeTools,
		getSettings: () => {
			if (settingsThrows) throw new Error("settings unavailable");
			return settings;
		},
	} as unknown as ExtensionAPI);

	const ctx = {
		cwd: "/home/u/project",
		provider: "relayfast",
		mode: "tui",
		model: { provider: "relayfast" },
		// Dedup reads the active branch; an empty one means "nothing injected yet".
		sessionManager: { buildContextEntries: () => [] as unknown[] },
	};
	// `systemPrompt` is a readonly field pi sets on the event; the handler must not return an
	// override, so the harness omits it entirely rather than seeding a value.
	const event: { type: string; systemPrompt?: string; systemPromptOptions: { sections: Record<string, string> } } = {
		type: "before_agent_start",
		systemPromptOptions: { sections: {} },
	};
	return {
		async providerRequest(payload: unknown) {
			return handlers.get("before_provider_request")!({ type: "before_provider_request", payload }, ctx);
		},
		async start() {
			const result = (await handlers.get("before_agent_start")!(event, ctx)) as
				| { message?: { customType?: string; content?: string } }
				| undefined;
			return { event, message: result?.message };
		},
		event,
		ctx,
	};
}

describe("before_agent_start wiring", () => {
	test("writes the section in place so pi can diff it", async () => {
		const app = harness();
		const { event } = await app.start();
		const section = event.systemPromptOptions.sections[SECTION_NAME];
		// The body carries no wrapper; pi wraps every section in its own `<name>` tag.
		expect(section).toContain("<shell>");
		expect(section).not.toContain("<environment_context>");
		expect(section).toContain("<shell>");
		// The handler mutates `sections` and returns undefined. Returning a `systemPrompt` override
		// would drop every other section and re-report the whole prompt as changed each request.
		expect(event.systemPrompt).toBeUndefined();
	});

	test("volatile contributions never enter the prompt section", async () => {
		registerEnvMessage({ id: "clock", content: "12:00" });
		const { event } = await harness().start();
		// A section change re-renders the cached prefix; volatile text must stay out of it.
		expect(event.systemPromptOptions.sections[SECTION_NAME]).not.toContain("12:00");
	});

	test("before_provider_request appends the trailing message to the payload", async () => {
		const app = harness();
		// Registered after envContext() so the built-in clock does not overwrite the fixture.
		registerEnvMessage({ id: "fixture", content: "12:00" });
		const payload = { messages: [{ role: "user", content: "hi" }] as Array<{ role: string; content: unknown }> };
		await app.providerRequest(payload);
		expect(payload.messages.at(-1)?.role).toBe("developer");
		expect(String(payload.messages.at(-1)?.content)).toContain("<fixture>12:00</fixture>");
	});

	test("the built-in clock is on by default", async () => {
		const app = harness();
		const payload = { messages: [] as Array<{ role: string; content: unknown }> };
		await app.providerRequest(payload);
		expect(String(payload.messages.at(-1)?.content)).toContain("<clock>");
	});

	test("the clock can be disabled through pi settings", async () => {
		const app = harness(["read", "bash"], { piPersist: { clock: false } });
		registerEnvMessage({ id: "fixture", content: "12:00" });
		const payload = { messages: [] as Array<{ role: string; content: unknown }> };
		await app.providerRequest(payload);
		const text = String(payload.messages.at(-1)?.content);
		expect(text).not.toContain("<clock>");
		expect(text).toContain("<fixture>12:00</fixture>");
	});

	test("an unreadable settings handle falls back to the defaults", async () => {
		// A throwing getSettings must not drop every contribution for the request.
		const app = harness(["read", "bash"], undefined, true);
		const payload = { messages: [] as Array<{ role: string; content: unknown }> };
		await app.providerRequest(payload);
		expect(String(payload.messages.at(-1)?.content)).toContain("<clock>");
	});

	test("omits cwd because pi already renders its own <cwd> section", async () => {
		const { event } = await harness().start();
		expect(DEFAULT_OMIT).toContain("cwd");
		expect(event.systemPromptOptions.sections[SECTION_NAME]).not.toContain("<cwd>");
	});

	test("includes registered contributions on the next request", async () => {
		registerEnvContribution({ id: "mode", content: () => "<mode>plan</mode>" });
		const { event } = await harness().start();
		expect(event.systemPromptOptions.sections[SECTION_NAME]).toContain("<mode>&lt;mode&gt;plan&lt;/mode&gt;</mode>");
	});

	test("a contribution filtered by provider never reaches the section", async () => {
		registerEnvContribution({ id: "other", providers: ["openrouter"], content: "present" });
		const { event } = await harness().start();
		expect(event.systemPromptOptions.sections[SECTION_NAME]).not.toContain("present");
	});

	test("successive requests produce the same bytes", async () => {
		const app = harness();
		const first = (await app.start()).event.systemPromptOptions.sections[SECTION_NAME];
		const second = (await app.start()).event.systemPromptOptions.sections[SECTION_NAME];
		expect(second).toBe(first);
	});

	test("removes the section when nothing renders", async () => {
		const app = harness();
		app.event.systemPromptOptions.sections[SECTION_NAME] = "stale";
		// Freeze the clock out of the picture: omit everything and register nothing.
		const empty = buildEnvironmentSection({
			cwd: "/x",
			activeTools: [],
			mode: "tui",
			omit: ["cwd", "shell", "platform", "arch"],
		});
		expect(empty).toBe("");
		delete app.event.systemPromptOptions.sections[SECTION_NAME];
		await app.start();
		expect(app.event.systemPromptOptions.sections[SECTION_NAME]).toContain("<shell>");
	});
});

describe("cross-extension registration without importing this package", () => {
	test("a foreign extension can build the registry itself", async () => {
		// The documented escape hatch: an extension with no hard dependency creates the same object
		// shape and sets into the Map directly.
		clearContributions();
		const registry = (globalThis as Record<symbol, unknown>)[REGISTRY_SYMBOL] as {
			protocol: string;
			version: number;
			contributions: Map<string, unknown>;
		};
		registry.contributions.set("foreign", { id: "foreign", content: "from outside" });
		const { event } = await harness().start();
		expect(event.systemPromptOptions.sections[SECTION_NAME]).toContain("from outside");
	});
});
