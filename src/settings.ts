import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Settings for this extension, read from pi's own `settings.json`.
 *
 * Pi's settings schema declares `additionalProperties: true`, so a namespaced key survives
 * validation and is visible through `pi.getSettings()`. That keeps configuration in one file
 * rather than inventing another, at the cost of not appearing in `/settings` — pi 1.4 offers no
 * way for an extension to contribute a row there.
 *
 * Read per request rather than cached at load: editing `settings.json` and running `/reload`
 * should take effect without a restart.
 */
export const SETTINGS_KEY = "piEnvContext";

export interface EnvContextSettings {
	/** Append the current date and time as a trailing item. */
	clock: boolean;
}

export const DEFAULT_SETTINGS: EnvContextSettings = { clock: true };

/**
 * Pi's `Settings` type declares no index signature for extension keys, so the value is cast at the
 * boundary rather than widening our own signature to accept anything.
 */
type SettingsSource = object | undefined;

/** Coerce the namespaced block, ignoring anything that is not shaped like our settings. */
export function readEnvContextSettings(settings: SettingsSource): EnvContextSettings {
	const raw = settings ? (settings as Record<string, unknown>)[SETTINGS_KEY] : undefined;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
	const block = raw as { clock?: unknown };
	return { clock: typeof block.clock === "boolean" ? block.clock : DEFAULT_SETTINGS.clock };
}

const FORMATTER = new Intl.DateTimeFormat("en-GB", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
	timeZoneName: "short",
});

/**
 * The current instant as one line: local time with an explicit zone.
 *
 * The zone matters — a bare `2026-10-28 00:52` is ambiguous to a model that does not know where
 * the host is, and the whole point of the item is answering "when is it".
 */
export function formatClock(now = new Date()): string {
	return FORMATTER.format(now);
}

/**
 * Fallback settings reader for callers that have no `pi` handle — tests, and any future
 * non-pi host. Mirrors what pi's settings manager does: read `<agent-dir>/settings.json`.
 */
export function readSettingsFromDisk(agentDir = getAgentDir()): EnvContextSettings {
	try {
		const parsed: unknown = JSON.parse(readFileSync(resolve(agentDir, "settings.json"), "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...DEFAULT_SETTINGS };
		return readEnvContextSettings(parsed as Record<string, unknown>);
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

/** The contribution the clock registers. Exported so tests can assert on it without a registry. */
export const CLOCK_CONTRIBUTION_ID = "clock";
