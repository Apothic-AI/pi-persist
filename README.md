# pi-persist

A pi extension that gives other extensions two ways to put text in front of the model: a **prompt
section** for facts that hold for the session, and a **trailing developer message** for anything
that changes or that the model must never lose mid-run.

The section looks like this (Linux box, zsh as `$SHELL`) — verbatim as the model receives it:

```text
<environment_context>
  <shell>/bin/bash</shell>
  <platform>linux</platform>
  <arch>x64</arch>
  <pi-mode mode="plan">read-only; nothing has been executed</pi-mode>
</environment_context>
```

Only the inner body is rendered by this extension. Pi wraps every prompt section in `<name>…</name>`
itself (`buildSystemPromptSections`), so emitting the wrapper here would nest
`<environment_context>` inside an identical outer tag.

## Install

```
pi install npm:@apothic-ai/pi-persist
```

or from a checkout:

```
pi install /path/to/pi-persist
```

## Two channels, chosen by the contributor

| | Section — `registerEnvContribution` | Trailing — `registerEnvMessage` |
| --- | --- | --- |
| Lands in | the leading system prompt | the end of every request's message list |
| Fires | per run (`before_agent_start`) | per request (`before_provider_request`) |
| Cache | cached with the prefix until it changes | never cached; fresh input every request |
| Cost of a change | re-renders the cached prompt prefix | one small message |
| Survives a tool loop | yes, it is in the prefix | yes, it is re-appended every request |
| Role on the wire | `developer` or `system`, per provider | `developer` |

Pick the section for text that is true for the whole session: the shell, the platform, a mode flag.
It is written once and then served from the prompt cache.

Pick the trailing message for text that changes, or that the model must read on *every* request.
A tool-using run issues several requests, and anything injected per run is missing from all but the
first.

### Why the trailing message is per request

`before_agent_start` fires once per **run**, not per model call. A run with three tool calls makes
four requests; a message injected there reaches the model once and then vanishes from its view for
the rest of the run — exactly when it is most useful. The trailing channel hooks
`before_provider_request` instead, so it lands after the final tool result on every request.

It is appended to the provider payload rather than returned as a message, because pi's
`convertToLlm` flattens `role: "custom"` to `role: "user"` (`core/messages.js`). An appended
`custom` message competes with the user's request; an appended `developer` item does not.

### Measured behaviour

Verified by loading the extension into pi and inspecting the outgoing payload:

| Provider / model | API | payload key | trailing role | status |
| --- | --- | --- | --- | --- |
| `subrouter/deepseek-v4.1-flash-1017` | `openai-completions` | `messages` | `developer` | 200 |
| `openrouter/xiaomi/mimo-v2.6-flash:nitro` | `openai-completions` | `messages` | `developer` | 200 |
| `opencode-go/minimax-m3.1-flash` | `openai-completions` | `messages` | `developer` | 200 |
| `openai/gpt-6-luna` via OpenRouter `/responses` | `openai-responses` | `input` | `developer` (`input_text` blocks) | 200 |

`openai-completions` payloads carry `messages`; `openai-responses` payloads carry `input`. Both are
handled. A payload with neither key is left untouched rather than guessed at — if a provider ever
changes shape, this channel no-ops for it instead of corrupting the request.

### Cost warning

A trailing message is **never cached**. It is fresh, uncached input on every request of every run,
including each step of a tool loop. That is the price of "the model always sees it", and it is the
right trade for short text.

Keep trailing contributions small. A few hundred bytes is free in practice; a multi-kilobyte block
here means re-sending that block on every request for the life of the session. If a contribution is
large and stable, it belongs in the section, where it is paid for once.

The extension does not enforce this — no length cap, no runtime warning. Sizing is the
contributor's judgement.

## Section API

```ts
import { registerEnvContribution } from "@apothic-ai/pi-persist";

const unregister = registerEnvContribution({
	id: "pi-mode",
	priority: 10,
	providers: ["relayfast"],
	activeTools: ["read"],
	content: ({ mode }) => (mode === "plan" ? "read-only; nothing has been executed" : undefined),
});
```

| Field | Meaning |
| --- | --- |
| `id` | Required and unique. Registering the same id again replaces the earlier entry. |
| `priority` | Lower renders first; ties break on `id`, so output never depends on registration order. |
| `providers` | Skip unless the active provider is listed. Skipped when the provider is unknown. |
| `activeTools` | Skip unless every listed tool is active. |
| `content` | A string, or a function of `{ provider, activeTools, cwd, mode }`. Empty results are dropped. |

Values are collapsed to a single line and XML-escaped, so a contributor cannot break the envelope.
A throwing `content` callback is skipped rather than taking down the prompt.

**`cwd` is deliberately omitted from the base section.** Pi already renders its own `<cwd>` section;
repeating it would duplicate the same value on every request. Pass `omit` to drop more fields.

### Shell reporting

`shell` is the shell pi's own command tool spawns, resolved through pi's exported `getShellConfig` —
a configured `shellPath`, then Git for Windows, then `/bin/bash`, then `bash` on `PATH`, then `sh`.

It is **not** `$SHELL`. Those differ: `$SHELL` names the interactive login shell, while commands run
under whatever pi resolved. On a machine with zsh as `$SHELL` and `/bin/bash` present, commands run
in bash — reporting zsh would be wrong in a way the model cannot detect.

## Trailing API

```ts
import { registerEnvMessage } from "@apothic-ai/pi-persist";

const unregister = registerEnvMessage({
	id: "clock",
	content: () => new Date().toISOString(),
});
```

Same `id` / `priority` / `providers` / `activeTools` / `content` shape. Contributions that resolve on
the same request are folded into one trailing message, ordered by priority then id.

Nothing is persisted: the trailing message exists only on the request it was built for, so nothing
accumulates in the session or the transcript.

### What the model sees

The message is appended after the user's turn and after any tool results, where it would otherwise
read as a continuation of the conversation — a second instruction competing with the one the user
actually gave. So it is wrapped, and it says what it is:

```
<pi_context>
This block is ambient context supplied automatically before each request. It is not a user
message and not a new instruction. Continue with the task you were already given; use this
only as reference.
  <clock>27/10/2026, 21:19:15 GMT-4</clock>
  <git-branch>apothic</git-branch>
  <pi-core-todo-summary>3 in progress, 12 done</pi-core-todo-summary>
</pi_context>
```

The `<clock>` item is built in and on by default. It renders the host's local time with an explicit
zone, because a bare timestamp is ambiguous to a model that does not know where the host is — the
whole point of the item is answering "when is it". See [Settings](#settings).

Each contribution is nested in a tag derived from its `id`, so the model can tell which extension
supplied which fact. Ids are normalized to valid tag names: `pi-core-todo/summary` becomes
`<pi-core-todo-summary>`, a leading digit is prefixed with `item-`, and anything left unusable
becomes `<item-unnamed>`.

Contributed text is whitespace-collapsed and XML-escaped, so a value cannot break out of its tag.
Do not wrap your own contribution in markup — the envelope already does it, and nesting your own
tags only double-escapes them.

## Settings

Configuration lives in pi's own `settings.json` under a `piPersist` namespace. Pi's settings
schema declares `additionalProperties: true`, so the key survives validation and is readable through
`pi.getSettings()`.

```json
{
  "piPersist": {
    "clock": true
  }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `clock` | `true` | Append the current local date and time as a trailing `<clock>` item. |

Set `clock` to `false` to drop the item entirely; the rest of the trailing channel keeps working.
Settings are read per request, so `/reload` picks up an edit without a restart.

A settings read that fails — an unavailable handle, a malformed file — falls back to the defaults
rather than dropping every contribution for that request.

Pi 1.4 offers no way for an extension to contribute a row to `/settings` (`SettingsSelectorComponent`
takes a fixed option list and `ExtensionAPI` exposes only `getSettings()`), so this file is the
whole surface.

## Declarative items

Everything above is a programmatic API: an extension calls `register…` with a function, which is
what makes per-request values possible. A second path covers the other case — a static value with a
policy, added without writing any code. Both feed the same registries, so rendering cannot tell them
apart.

Items live in `~/.pi/agent/pi-persist.json`:

```json
{
  "version": 1,
  "items": [
    {
      "id": "when",
      "channel": "trailing",
      "content": "at {{datetime}} on {{exec:git rev-parse --abbrev-ref HEAD}}",
      "priority": 5,
      "providers": ["subrouter"],
      "activeTools": ["read"]
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique per channel. Becomes the XML tag name. |
| `channel` | yes | `trailing` (per request, uncached) or `section` (cached with the prompt). |
| `content` | yes | Body text, with `{{…}}` templates expanded per request. |
| `priority` | no | Lower sorts first. Default `0`. |
| `providers` | no | Skip unless the active provider is listed. |
| `activeTools` | no | Skip unless every listed tool is active. |

A malformed entry is skipped and reported rather than thrown, so one bad item cannot stop a session
from starting. Run `pi-persist list` to see what was skipped and why.

Declarative items are loaded once at extension load, so `/reload` picks up an edit.

## Templates

Two forms: `{{name}}` and `{{name:argument}}`. Inner whitespace is ignored.

| Template | Result |
| --- | --- |
| `{{datetime}}` | local date and time with zone — `28/10/2026, 01:32:44 GMT-4` |
| `{{datetime:iso}}` | ISO 8601 |
| `{{datetime:date}}` | local date only |
| `{{datetime:time}}` | local time only |
| `{{datetime:unix}}` | seconds since the epoch |
| `{{exec:<command>}}` | trimmed stdout of a shell command, run on every request |

`datetime` is the only built-in for now. Anything else comes from `exec:`:

```text
{{exec:echo $HOME}}                              # an environment variable
{{exec:git rev-parse --abbrev-ref HEAD}}         # the current branch
{{exec:date +%H:%M}}                             # the clock, your format
```

There is deliberately **no environment-variable syntax**. `exec:` covers it — one mechanism instead
of one placeholder per source.

**Explicit only.** A command never runs unless the item author wrote `{{exec:…}}`. A bare `{{NAME}}`
is not an environment lookup, and unknown placeholders are left verbatim and reported, so a typo
stays visible instead of silently becoming an empty string.

**No caching.** A command runs on every request, because a stale clock is worse than a fresh one and
`echo`/`date` cost microseconds. A command that hangs is killed after three seconds rather than
stalling the request.

**This is arbitrary code execution from a config file.** Anyone who can edit `pi-persist.json` can
already run commands as you, so it is not a privilege boundary — but it does mean you should read an
items file before adding it to a machine you care about.

## CLI

```sh
pi-persist list
pi-persist add <id> <content> [--channel trailing|section] [--priority n] [--providers a,b] [--tools x,y]
pi-persist remove <id> [--channel trailing|section]
pi-persist clock [on|off]
```

```console
$ pi-persist add when 'at {{datetime}} on {{exec:git rev-parse --abbrev-ref HEAD}}' --priority 5
added trailing item "when"
Takes effect on the next /reload or session start.

$ pi-persist list
items file: /home/u/.pi/agent/pi-persist.json
clock: on  (piPersist.clock)

ID    CHANNEL   POLICY      CONTENT
----  --------  ----------  ---------------------------
when  trailing  priority=5  at 27/10/2026, 21:43:29 GMT-4 on main
```

`list` expands templates against the current machine, so a wrong `exec:` shows up immediately
instead of after a reload. `pi-persist clock off` writes `piPersist.clock` in pi's own
`settings.json`, preserving every other key.

The CLI talks to files only — no pi process, no session. Changes take effect on the next `/reload`
or session start.

## Without importing the package

Both registries live on `globalThis`, guarded by a symbol plus a `protocol`/`version` pair:

```ts
const key = Symbol.for("pi-persist/contributors/v1");     // section
const key = Symbol.for("pi-persist/messages/v1");         // trailing

const registry = ((globalThis as any)[key] ??= {
	protocol: "pi-persist/contributors",  // or "pi-persist/messages"
	version: 1,
	contributions: new Map(),
});
registry.contributions.set("my-extension/block", { id: "my-extension/block", content: "..." });
```

This package adopts a pre-existing registry when it loads and reads it at render time, so load order
does not matter. It declines to write into a value that occupies the symbol with a different
`protocol` or `version`.

## Why a global registry

Pi's extension API has no way for one extension to hand data to another. A `globalThis` slot is the
only mechanism that works across load order and across duplicate package instances (a session can
load the same extension from an npm cache and a local path). The `protocol` and `version` fields are
the guard: a future breaking change bumps `version` instead of silently corrupting entries written
by an older copy.

## Develop

```sh
bun test
npx tsc --noEmit
biome check .
```
