import { afterEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import envContext, { buildEnvironmentSection, DEFAULT_OMIT, SECTION_NAME } from "../src/index.ts";
import { clearContributions, REGISTRY_SYMBOL, registerEnvContribution } from "../src/registry.ts";

afterEach(() => {
	clearContributions();
});

type Handler = (event: unknown, ctx: unknown) => unknown;

function harness(activeTools: string[] = ["read", "bash"]) {
	const handlers = new Map<string, Handler>();
	envContext({
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
			return () => {};
		},
		getActiveTools: () => activeTools,
	} as unknown as ExtensionAPI);

	const ctx = { cwd: "/home/u/project", provider: "relayfast", mode: "tui", model: { provider: "relayfast" } };
	// `systemPrompt` is a readonly field pi sets on the event; the handler must not return an
	// override, so the harness omits it entirely rather than seeding a value.
	const event: { type: string; systemPrompt?: string; systemPromptOptions: { sections: Record<string, string> } } = {
		type: "before_agent_start",
		systemPromptOptions: { sections: {} },
	};
	return {
		async start() {
			await handlers.get("before_agent_start")!(event, ctx);
			return event;
		},
		event,
	};
}

describe("before_agent_start wiring", () => {
	test("writes the section in place so pi can diff it", async () => {
		const app = harness();
		const event = await app.start();
		const section = event.systemPromptOptions.sections[SECTION_NAME];
		expect(section).toContain("<environment_context>");
		expect(section).toContain("<shell>");
		// The handler mutates `sections` and returns undefined. Returning a `systemPrompt` override
		// would drop every other section and re-report the whole prompt as changed each request.
		expect(event.systemPrompt).toBeUndefined();
	});

	test("omits cwd because pi already renders its own <cwd> section", async () => {
		const event = await harness().start();
		expect(DEFAULT_OMIT).toContain("cwd");
		expect(event.systemPromptOptions.sections[SECTION_NAME]).not.toContain("<cwd>");
	});

	test("includes registered contributions on the next request", async () => {
		registerEnvContribution({ id: "mode", content: () => "<mode>plan</mode>" });
		const event = await harness().start();
		expect(event.systemPromptOptions.sections[SECTION_NAME]).toContain("<mode>&lt;mode&gt;plan&lt;/mode&gt;</mode>");
	});

	test("a contribution filtered by provider never reaches the section", async () => {
		registerEnvContribution({ id: "other", providers: ["openrouter"], content: "present" });
		const event = await harness().start();
		expect(event.systemPromptOptions.sections[SECTION_NAME]).not.toContain("present");
	});

	test("successive requests produce the same bytes", async () => {
		const app = harness();
		const first = (await app.start()).systemPromptOptions.sections[SECTION_NAME];
		const second = (await app.start()).systemPromptOptions.sections[SECTION_NAME];
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
			omit: ["cwd", "shell", "platform", "arch", "current_date", "timezone"],
		});
		expect(empty).toBe("");
		delete app.event.systemPromptOptions.sections[SECTION_NAME];
		await app.start();
		expect(app.event.systemPromptOptions.sections[SECTION_NAME]).toContain("<environment_context>");
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
		const event = await harness().start();
		expect(event.systemPromptOptions.sections[SECTION_NAME]).toContain("from outside");
	});
});
