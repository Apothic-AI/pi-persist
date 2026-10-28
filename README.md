# pi-env-context

A pi extension that gives other extensions two ways to put text in front of the model: a **prompt
section** for facts that hold for the session, and a **trailing developer message** for anything
that changes or that the model must never lose mid-run.

The section looks like this (Linux box, zsh as `$SHELL`):

```text
<environment_context>
  <shell>/bin/bash</shell>
  <platform>linux</platform>
  <arch>x64</arch>
  <pi-mode mode="plan">read-only; nothing has been executed</pi-mode>
</environment_context>
```

## Install

```
pi install npm:@apothic-ai/pi-env-context
```

or from a checkout:

```
pi install /path/to/pi-env-context
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
import { registerEnvContribution } from "@apothic-ai/pi-env-context";

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
import { registerEnvMessage } from "@apothic-ai/pi-env-context";

const unregister = registerEnvMessage({
	id: "clock",
	content: () => new Date().toISOString(),
});
```

Same `id` / `priority` / `providers` / `activeTools` / `content` shape. Contributions that resolve on
the same request are folded into one trailing message, ordered by priority then id.

Nothing is persisted: the trailing message exists only on the request it was built for, so nothing
accumulates in the session or the transcript.

## Without importing the package

Both registries live on `globalThis`, guarded by a symbol plus a `protocol`/`version` pair:

```ts
const key = Symbol.for("pi-add-env/contributors/v1");     // section
const key = Symbol.for("pi-add-env/messages/v1");         // trailing

const registry = ((globalThis as any)[key] ??= {
	protocol: "pi-add-env/contributors",  // or "pi-add-env/messages"
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
