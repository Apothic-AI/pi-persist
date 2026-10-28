import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { detectEnvironment, type EnvBlock, renderEnvironment } from "./environment.ts";
import { appendTrailingMessage } from "./messages.ts";
import { type ContributionContext, collectContributions } from "./registry.ts";

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
export default function envContext(pi: ExtensionAPI) {
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
