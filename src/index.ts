import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { detectEnvironment, type EnvBlock, renderEnvironment } from "./environment.ts";
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
	now?: Date;
	omit?: readonly string[];
}

/**
 * Build the section body for one request. Exported so tests and non-pi consumers can render the
 * same envelope without running the extension.
 */
export function buildEnvironmentSection(options: BuildSectionOptions): string {
	const facts = detectEnvironment(options.cwd, options.now ?? new Date());
	const context: ContributionContext = {
		provider: options.provider,
		activeTools: options.activeTools,
		cwd: options.cwd,
		mode: options.mode,
	};
	const blocks: EnvBlock[] = collectContributions(context);
	return renderEnvironment(facts, { omit: options.omit ?? DEFAULT_OMIT, blocks });
}

export default function envContext(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		// Mutate the section in place so pi diffs it against the previous request and appends only
		// the delta, instead of replacing the whole system prompt.
		const section = buildEnvironmentSection({
			cwd: ctx.cwd,
			provider: ctx.model?.provider,
			activeTools: pi.getActiveTools(),
			mode: ctx.mode,
		});
		if (section) event.systemPromptOptions.sections[SECTION_NAME] = section;
		else delete event.systemPromptOptions.sections[SECTION_NAME];
	});
}

export type { EnvBlock, EnvField, EnvironmentFacts, ShellFacts } from "./environment.ts";
export { detectEnvironment, detectShell, escapeXml, renderEnvironment } from "./environment.ts";
export type { ContributionContext, EnvironmentContribution } from "./registry.ts";
export {
	REGISTRY_PROTOCOL,
	REGISTRY_SYMBOL,
	REGISTRY_VERSION,
	registerEnvContribution,
} from "./registry.ts";
