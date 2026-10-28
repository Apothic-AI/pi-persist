import { mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Declarative items, stored on disk so they can be edited by hand or by the CLI.
 *
 * The programmatic `registerEnvContribution` / `registerEnvMessage` path stays the primary API for
 * extensions: a contribution's `content` can be any function of the live request, which no file can
 * express. This store covers the other case — a static value with a policy, added without writing
 * code. Both paths feed the same registries, so downstream rendering cannot tell them apart.
 *
 * Items are recorded with the channel they target, because the two channels are not
 * interchangeable: a value that changes every request belongs in the trailing message, and a value
 * that never changes is cheaper in the section, where it is cached with the prompt prefix.
 */
export const ITEMS_FILENAME = "pi-persist.json";

export type ItemChannel = "trailing" | "section";

export interface DeclarativeItem {
	/** Unique per channel. Registering the same id again replaces the earlier item. */
	id: string;
	channel: ItemChannel;
	/** Body text. `{{…}}` templates are expanded per request. */
	content: string;
	/** Lower renders first; ties break on id. */
	priority?: number;
	providers?: string[];
	activeTools?: string[];
}

export interface ItemsFile {
	version: 1;
	items: DeclarativeItem[];
}

export const EMPTY_ITEMS_FILE: ItemsFile = { version: 1, items: [] };

export function itemsFilePath(agentDir = getAgentDir()): string {
	return join(agentDir, ITEMS_FILENAME);
}

const ITEM_ID = /^[A-Za-z][\w.:-]*$/;

export interface ValidationResult {
	items: DeclarativeItem[];
	/** Problems that caused an item to be skipped. Surfaced by `list` rather than thrown, so one bad */
	/** entry cannot take down a session. */
	errors: string[];
}

/** Coerce one untrusted entry, or explain why it was skipped. */
function normalizeItem(raw: unknown, index: number, seen: Set<string>): { item?: DeclarativeItem; error?: string } {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `item ${index}: not an object` };
	const entry = raw as Record<string, unknown>;
	const id = typeof entry.id === "string" ? entry.id.trim() : "";
	if (!id) return { error: `item ${index}: missing id` };
	if (!ITEM_ID.test(id)) return { error: `item ${index} (${id}): id must match ${ITEM_ID}` };
	const channel = entry.channel === "section" ? "section" : entry.channel === "trailing" ? "trailing" : undefined;
	if (!channel) return { error: `item ${index} (${id}): channel must be "trailing" or "section"` };
	if (typeof entry.content !== "string") return { error: `item ${index} (${id}): content must be a string` };
	const key = `${channel}:${id}`;
	if (seen.has(key)) return { error: `item ${index} (${id}): duplicate ${channel} id` };
	seen.add(key);
	const item: DeclarativeItem = { id, channel, content: entry.content };
	if (typeof entry.priority === "number" && Number.isFinite(entry.priority)) item.priority = entry.priority;
	const providers = stringList(entry.providers);
	if (providers) item.providers = providers;
	const activeTools = stringList(entry.activeTools);
	if (activeTools) item.activeTools = activeTools;
	return { item };
}

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return;
	const list = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
	return list.length > 0 ? list : undefined;
}

/** Parse a file body. Never throws: a malformed file degrades to zero items plus an error. */
export function parseItemsFile(raw: string): ValidationResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		return { items: [], errors: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { items: [], errors: ["top level must be an object"] };
	}
	const entries = (parsed as { items?: unknown }).items;
	if (entries === undefined) return { items: [], errors: [] };
	if (!Array.isArray(entries)) return { items: [], errors: ["items must be an array"] };
	const items: DeclarativeItem[] = [];
	const errors: string[] = [];
	const seen = new Set<string>();
	entries.forEach((entry, index) => {
		const { item, error } = normalizeItem(entry, index, seen);
		if (item) items.push(item);
		if (error) errors.push(error);
	});
	return { items, errors };
}

/** Read the items file. A missing file is an empty list, not an error. */
export function readItemsFile(path = itemsFilePath()): ValidationResult {
	try {
		return parseItemsFile(readFileSync(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { items: [], errors: [] };
		return { items: [], errors: [`could not read ${path}: ${String(error)}`] };
	}
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** Serialize writes so a concurrent CLI invocation cannot interleave with a rename. */
export function writeItemsFile(file: ItemsFile, path = itemsFilePath()): Promise<void> {
	const write = writeQueue.then(async () => {
		mkdirSync(dirname(path), { recursive: true });
		await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
	});
	writeQueue = write.catch(() => {});
	return write;
}

/** Read-modify-write. Every mutation goes through this so unrelated items survive an edit. */
export async function updateItemsFile(
	mutate: (file: ItemsFile) => ItemsFile | undefined,
	path = itemsFilePath(),
): Promise<ItemsFile> {
	const { items } = readItemsFile(path);
	const next = mutate({ version: 1, items }) ?? { version: 1, items };
	await writeItemsFile(next, path);
	return next;
}

/** Register-time guard: reject text that cannot become a tag, before it reaches a registry. */
export function isValidItemId(id: string): boolean {
	return ITEM_ID.test(id);
}
