import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, readPersistSettings, readSettingsFromDisk, SETTINGS_KEY } from "../src/settings.ts";

describe("readPersistSettings", () => {
	test("defaults when the namespace is absent", () => {
		expect(readPersistSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(readPersistSettings({})).toEqual(DEFAULT_SETTINGS);
	});

	test("ignores malformed blocks instead of throwing", () => {
		expect(readPersistSettings({ [SETTINGS_KEY]: null })).toEqual(DEFAULT_SETTINGS);
		expect(readPersistSettings({ [SETTINGS_KEY]: [] })).toEqual(DEFAULT_SETTINGS);
		expect(readPersistSettings({ [SETTINGS_KEY]: "off" })).toEqual(DEFAULT_SETTINGS);
	});

	test("ignores unknown keys", () => {
		expect(readPersistSettings({ [SETTINGS_KEY]: { future: true } })).toEqual(DEFAULT_SETTINGS);
	});

	test("leaves unrelated settings untouched", () => {
		const settings = { theme: "neon-noir", [SETTINGS_KEY]: { anything: 1 } };
		readPersistSettings(settings);
		expect(settings.theme).toBe("neon-noir");
	});
});

describe("readSettingsFromDisk", () => {
	// A temp dir, not a path under test/, so nothing can be committed by accident.
	afterEach(() => {});

	function freshDir(): string {
		return mkdtempSync(join(tmpdir(), "pi-persist-settings-"));
	}

	test("falls back to defaults when settings.json is missing", () => {
		expect(readSettingsFromDisk(join(tmpdir(), "pi-persist-missing-dir"))).toEqual(DEFAULT_SETTINGS);
	});

	test("falls back to defaults when the file is malformed", () => {
		const target = freshDir();
		writeFileSync(join(target, "settings.json"), "{ not json");
		expect(readSettingsFromDisk(target)).toEqual(DEFAULT_SETTINGS);
	});

	test("reads a real settings file without inventing keys", () => {
		const target = freshDir();
		writeFileSync(join(target, "settings.json"), JSON.stringify({ theme: "x", [SETTINGS_KEY]: {} }));
		expect(readSettingsFromDisk(target)).toEqual(DEFAULT_SETTINGS);
	});
});
