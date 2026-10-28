import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { detectEnvironment, type EnvBlock, renderEnvironment } from "./environment.ts";
import { itemsFilePath, readItemsFile } from "./items.ts";
import { appendTrailingMessage, type MessageContext, registerEnvMessage } from "./messages.ts";
import { type ContributionContext, collectContributions, registerEnvContribution } from "./registry.ts";
import {
	CLOCK_CONTRIBUTION_ID,
	DEFAULT_SETTINGS,
	type EnvContextSettings,
	formatClock,
	readEnvContextSettings,
} from "./settings.ts";
import { expandTemplate } from "./template.ts";

/** Prompt section name. Pi renders it as `<environment_context>…</environment_context>`. */
export const SECTION_NAME = "environment_context";

/**
 * Fields pi already renders elsewhere in its own prompt. `cwd` is its own `<cwd>` section
 * (`system-prompt.js`), so repeating it here would duplicate a value on every request.
 */
export const DEFAULT_OMIT: readonly string[] = ["cwd"];

export interface BuildSectionOptions {
	cwd: string;
	provider?: string;
	activeTools: readonly string[];
	mode: string;
	omit?: readonly string[];
}

/**
 * Build the section body for one request. Exported so tests and non-pi consumers can render the
 * same envelope without running the extension.
 */
export function buildEnvironmentSection(options: BuildSectionOptions): string {
	const facts = detectEnvironment(options.cwd);
	const context: ContributionContext = {
		provider: options.provider,
		activeTools: options.activeTools,
		cwd: options.cwd,
		mode: options.mode,
	};
	const blocks: EnvBlock[] = collectContributions(context);
	return renderEnvironment(facts, { omit: options.omit ?? DEFAULT_OMIT, blocks });
}

/**
 * Two injection channels with different economics.
 *
 * - `registry.ts` (section) for text that holds for the session: written once into the leading
 *   system prompt, then served from the prompt cache until it changes.
 * - `messages.ts` (trailing) for everything else: appended to every request after the final tool
 *   result, never cached, never lost mid-run.
 *
 * A contributor picks the channel by calling the matching register function. Neither channel is
 * persisted by this extension, so nothing accumulates in the transcript.
 */
/** Settings via the live pi handle, degrading to defaults when it cannot answer. */
export function settingsForPi(pi: Pick<ExtensionAPI, "getSettings">): EnvContextSettings {
	try {
		return readEnvContextSettings(pi.getSettings());
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

/**
 * Register every item from the items file into the live registries.
 *
 * Declarative items take the same path as programmatic ones, so rendering cannot tell them apart.
 * Returns the unregister functions plus any validation errors, which are surfaced rather than
 * thrown: a bad entry must not prevent a session from starting.
 */
export function loadDeclarativeItems(path = itemsFilePath()): { unregister: Array<() => void>; errors: string[] } {
	const { items, errors } = readItemsFile(path);
	const unregister: Array<() => void> = [];
	for (const item of items) {
		const content = ({ cwd }: ContributionContext | MessageContext) =>
			expandTemplate(item.content, { cwd }) || undefined;
		if (item.channel === "section") {
			unregister.push(
				registerEnvContribution({
					id: item.id,
					priority: item.priority,
					providers: item.providers,
					activeTools: item.activeTools,
					content,
				}),
			);
		} else {
			unregister.push(
				registerEnvMessage({
					id: item.id,
					priority: item.priority,
					providers: item.providers,
					activeTools: item.activeTools,
					content,
				}),
			);
		}
	}
	return { unregister, errors };
}

export default function envContext(pi: ExtensionAPI) {
	// Declarative items are loaded once per session; `/reload` re-runs this and picks up edits.
	const declarative = loadDeclarativeItems();
	if (declarative.errors.length > 0) {
		console.warn(`pi-persist: ${declarative.errors.length} item(s) skipped in ${itemsFilePath()}`);
		for (const error of declarative.errors) console.warn(`  ${error}`);
	}

	// Built-in trailing item. Registered here rather than by a consumer because it answers a
	// question every session has: what time is it, on this host, right now.
	registerEnvMessage({
		id: CLOCK_CONTRIBUTION_ID,
		priority: -100,
		// A settings read must never break the channel: if `getSettings` is unavailable or throws,
		// fall back to the defaults rather than dropping every contribution on this request.
		content: () => (settingsForPi(pi).clock ? formatClock() : undefined),
	});

	pi.on("before_agent_start", (event, ctx) => {
		const section = buildEnvironmentSection({
			cwd: ctx.cwd,
			provider: ctx.model?.provider,
			activeTools: pi.getActiveTools(),
			mode: ctx.mode,
		});
		// Mutate the section in place so pi diffs it against the previous request and appends only
		// the delta, instead of replacing the whole system prompt.
		if (section) event.systemPromptOptions.sections[SECTION_NAME] = section;
		else delete event.systemPromptOptions.sections[SECTION_NAME];
	});

	// Per request, not per run: a tool-using run issues several requests, and a trailing message
	// injected in `before_agent_start` would be missing from all but the first.
	pi.on("before_provider_request", (event, ctx) => {
		const options = { activeTools: pi.getActiveTools(), cwd: ctx.cwd, mode: ctx.mode };
		return appendTrailingMessage(event.payload, options, ctx.model?.provider);
	});
}

export type { EnvBlock, EnvField, EnvironmentFacts, ShellFacts } from "./environment.ts";
export { detectEnvironment, detectShell, escapeXml, renderEnvironment } from "./environment.ts";
export type { MessageContext, MessageContribution, ResolvedMessage, TrailingMessageOptions } from "./messages.ts";
export {
	appendTrailingMessage,
	collectMessages,
	ENVELOPE_TAG,
	MESSAGE_TYPE_PREFIX,
	payloadArrayKey,
	registerEnvMessage,
	renderTrailingMessage,
	supportsTrailingMessage,
	tagNameFor,
} from "./messages.ts";
export type { ContributionContext, EnvironmentContribution } from "./registry.ts";
export {
	REGISTRY_PROTOCOL,
	REGISTRY_SYMBOL,
	REGISTRY_VERSION,
	registerEnvContribution,
} from "./registry.ts";
export {
	CLOCK_CONTRIBUTION_ID,
	DEFAULT_SETTINGS,
	type EnvContextSettings,
	formatClock,
	readEnvContextSettings,
	readSettingsFromDisk,
	SETTINGS_KEY,
} from "./settings.ts";
