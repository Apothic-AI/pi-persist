# pi-env-context

A pi extension that renders an `<environment_context>` section into the system prompt, and lets other extensions append their own blocks to it. Output on a Linux box with zsh as `$SHELL`:

```text
<environment_context>
  <shell>/bin/bash</shell>
  <platform>linux</platform>
  <arch>x64</arch>
  <current_date>2026-10-27</current_date>
  <timezone>America/New_York</timezone>
  <pi-mode mode="plan">read-only; nothing has been executed</pi-mode>
</environment_context>
```

## Install

```
pi install npm:@bitnom/pi-env-context
```

or from a checkout:

```
pi install /path/to/pi-env-context
```

## What it does

On every `before_agent_start` it writes `systemPromptOptions.sections.environment_context`. Pi renders each section as its own tag and diffs sections per request, so only a changed section is appended to the transcript — the prompt cache survives quiet turns.

**`cwd` is deliberately omitted.** Pi already renders its own `<cwd>` section; repeating it here would duplicate the same value on every request. Pass `omit` to drop more fields.

### Shell reporting

`shell` is the shell pi's own command tool spawns, resolved through pi's exported `getShellConfig` — a configured `shellPath`, then Git for Windows, then `/bin/bash`, then `bash` on `PATH`, then `sh`.

It is **not** `$SHELL`. Those differ: `$SHELL` names the interactive login shell, while commands run under whatever pi resolved. On a machine with zsh as `$SHELL`, and `/bin/bash` present, commands run in bash — reporting zsh would be wrong in a way the model cannot detect.

## Contribute a block

```ts
import { registerEnvContribution } from "@bitnom/pi-env-context";

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

Returned values are collapsed to a single line and XML-escaped, so a contributor cannot break the envelope. A throwing `content` callback is skipped rather than taking down the prompt. Registering the same `id` twice replaces; the returned `unregister` removes only its own entry.

### Without importing the package

The registry lives on `globalThis` under `Symbol.for("pi-add-env/contributors/v1")` — a `Map<id, contribution>` alongside `protocol` and `version`:

```ts
const key = Symbol.for("pi-add-env/contributors/v1");
const registry = ((globalThis as any)[key] ??= {
	protocol: "pi-add-env/contributors",
	version: 1,
	contributions: new Map(),
});
registry.contributions.set("my-extension/block", { id: "my-extension/block", content: "..." });
```

This package adopts a pre-existing registry when it loads and reads it at render time, so load order does not matter. It declines to write into a value that occupies the symbol with a different `protocol` or `version`.

Detect that this package is active by checking whether `globalThis[Symbol.for("pi-add-env/contributors/v1")]` exists.

## Why a global registry

Pi's extension API has no way for one extension to hand data to another. A `globalThis` slot is the only mechanism that works across load order and across duplicate package instances (a session can load the same extension from an npm cache and a local path). The `protocol` and `version` fields are the guard: a future breaking change bumps `version` instead of silently corrupting entries written by an older copy.

## Develop

```sh
bun test
npx tsc --noEmit
biome check .
```
