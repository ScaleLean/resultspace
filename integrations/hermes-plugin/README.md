# Hermes knowledge integration

This repo-owned plugin exposes `rs_context` (project context, record context or search) and `rs_learn` (explicit sourced project learning). It adds the company brief at session start. Hermes owns its runtime and tools; ResultSpace holds company knowledge and provenance.

Use the profile's existing ResultSpace CLI config: `server_url`, `default_company`, and a `key_file` under `[companies.<slug>]`. Keys must be mode 0600 and are never returned by the knowledge tools. Named profiles require their own `resultspace/profiles/<name>/cli.toml` under the config directory; missing files fail closed. `default` uses `resultspace/cli.toml`. An explicit `RS_CONFIG` overrides either path. No installed profiles are changed by this repo.

## Upgrade cutoff

Server 0.4.0 and plugin 0.15.0 replace assignment, action-log, guard, presence, receipt and dispatch integrations. Retired operations return not-found. Remove old tool names from runtime configuration when upgrading; replace reads with `rs_context` and explicit outcomes with `rs log` or `rs_learn`.

The `resultspace-memory` provider has been retired. If an installed profile uses it, change that profile's provider during the reviewed upgrade to its runtime's supported memory provider. This repository does not modify MEMORY.md, SKILL.md or installed profiles. Method learnings remain sourced project knowledge; long-term skill ownership is undecided.

Verify against disposable companies:

```sh
cd integrations/hermes-plugin
python3 -m unittest discover -s tests -v
```

The review reports the installed default at 0.14.0 and default plus seven named configs using `resultspace-memory`. The [coordinated upgrade plan](../../docs/deploy/INSTALLED-CLIENT-MIGRATION.md) covers tool replacements, exact identity checks, preservation of runtime memory and disposable smoke tests for all eight configurations. No installation/profile change is performed here.
