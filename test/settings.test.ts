import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CLOCK_CONTRIBUTION_ID,
	DEFAULT_SETTINGS,
	formatClock,
	readEnvContextSettings,
	readSettingsFromDisk,
	SETTINGS_KEY,
} from "../src/settings.ts";

describe("readEnvContextSettings", () => {
	test("defaults when the namespace is absent", () => {
		expect(readEnvContextSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(readEnvContextSettings({})).toEqual(DEFAULT_SETTINGS);
	});

	test("reads a boolean clock flag", () => {
		expect(readEnvContextSettings({ [SETTINGS_KEY]: { clock: false } })).toEqual({ clock: false });
		expect(readEnvContextSettings({ [SETTINGS_KEY]: { clock: true } })).toEqual({ clock: true });
	});

	test("ignores malformed blocks instead of throwing", () => {
		expect(readEnvContextSettings({ [SETTINGS_KEY]: null })).toEqual(DEFAULT_SETTINGS);
		expect(readEnvContextSettings({ [SETTINGS_KEY]: [] })).toEqual(DEFAULT_SETTINGS);
		expect(readEnvContextSettings({ [SETTINGS_KEY]: "off" })).toEqual(DEFAULT_SETTINGS);
		expect(readEnvContextSettings({ [SETTINGS_KEY]: { clock: "no" } })).toEqual(DEFAULT_SETTINGS);
	});

	test("leaves unrelated settings untouched", () => {
		const settings = { theme: "neon-noir", [SETTINGS_KEY]: { clock: false } };
		readEnvContextSettings(settings);
		expect(settings.theme).toBe("neon-noir");
	});
});

describe("readSettingsFromDisk", () => {
	// A temp dir, not a path under test/, so nothing can be committed by accident.
	let dir = "";
	afterEach(() => {
		dir = "";
	});

	function freshDir(): string {
		dir = mkdtempSync(join(tmpdir(), "pi-env-context-settings-"));
		return dir;
	}

	test("falls back to defaults when settings.json is missing", () => {
		expect(readSettingsFromDisk(join(tmpdir(), "pi-env-context-missing-dir"))).toEqual(DEFAULT_SETTINGS);
	});

	test("falls back to defaults when the file is malformed", () => {
		const target = freshDir();
		writeFileSync(join(target, "settings.json"), "{ not json");
		expect(readSettingsFromDisk(target)).toEqual(DEFAULT_SETTINGS);
	});

	test("reads the namespace from a real settings file", () => {
		const target = freshDir();
		writeFileSync(join(target, "settings.json"), JSON.stringify({ [SETTINGS_KEY]: { clock: false } }));
		expect(readSettingsFromDisk(target)).toEqual({ clock: false });
	});
});

describe("formatClock", () => {
	test("includes a date, a time, and an explicit zone", () => {
		const text = formatClock(new Date("2026-10-28T00:52:00Z"));
		expect(text).toMatch(/\d{2}\/\d{2}\/\d{4}/);
		expect(text).toMatch(/\d{2}:\d{2}:\d{2}/);
		// Without a zone the string is ambiguous: the model cannot tell where the host is.
		expect(text).toMatch(/[A-Z]{2,5}|GMT|UTC/);
	});

	test("is stable for a fixed instant", () => {
		const at = new Date("2026-10-28T00:52:00Z");
		expect(formatClock(at)).toBe(formatClock(at));
	});
});

describe("clock contribution id", () => {
	test("is a stable, tag-safe id", () => {
		expect(CLOCK_CONTRIBUTION_ID).toBe("clock");
		expect(/^[A-Za-z][\w.-]*$/.test(CLOCK_CONTRIBUTION_ID)).toBe(true);
	});
});
