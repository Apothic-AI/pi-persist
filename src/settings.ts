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
 * There is no key here yet. The namespace is declared and parsed so a future switch has a home
 * that is already wired up, and so a stray `piPersist` block is read rather than ignored.
 */
export const SETTINGS_KEY = "piPersist";

export interface PersistSettings {
	/** Reserved. Nothing reads it yet. */
	readonly placeholder?: never;
}

export const DEFAULT_SETTINGS: PersistSettings = {};

/**
 * Pi's `Settings` type declares no index signature for extension keys, so the value is cast at the
 * boundary rather than widening our own signature to accept anything.
 */
type SettingsSource = object | undefined;

/** Coerce the namespaced block. Unknown keys are ignored; a malformed block degrades to defaults. */
export function readPersistSettings(settings: SettingsSource): PersistSettings {
	const raw = settings ? (settings as Record<string, unknown>)[SETTINGS_KEY] : undefined;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
	return { ...DEFAULT_SETTINGS };
}

/**
 * Fallback settings reader for callers that have no `pi` handle — the CLI, tests, and any future
 * non-pi host. Mirrors what pi's settings manager does: read `<agent-dir>/settings.json`.
 */
export function readSettingsFromDisk(agentDir = getAgentDir()): PersistSettings {
	try {
		const parsed: unknown = JSON.parse(readFileSync(resolve(agentDir, "settings.json"), "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...DEFAULT_SETTINGS };
		return readPersistSettings(parsed as Record<string, unknown>);
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}
