# ResultSpace

Each company's work, journal, knowledge and skills, kept apart from every other company.
Agents read and write it. People check it on a phone. A built-in Curator keeps the record true and
tells the owner what needs them.

## The four areas

| Area | What it holds | Kinds |
|---|---|---|
| **Work**: what we are doing | goals, projects, tasks, and assignments: an outcome handed to one agent, with the result it reports and whether a person verified it ([more](docs/design/ASSIGNMENTS.md)) | goal, project, task, assignment |
| **Journal**: what happened | outcomes (what changed or is now true), outward actions agents took, agent sessions, notes | entry (with a type) |
| **Knowledge**: what we know | pages, their sources, standing decisions, and each company's own kinds (products, formulas, claims...) | knowledge, source, decision, ... |
| **Skills**: how we do it | a skill cites the knowledge it depends on; agents fetch skills as SKILL.md files | skill |

Plus **Today**: the Curator's output. The briefing, requests that wait for a yes or no, flags, and work that needs a person.

Nothing is ever deleted: records are archived, and every version is kept.

## Layout

| Path | What |
|---|---|
| `src/core/` | One SQLite file per company: records, every revision, kinds, links, search, agents and their keys. No HTTP. |
| `src/operations/` | The one list of operations. The API, MCP, `rs` and the Curator's tools are all made from it. |
| `src/surfaces/` | `/v1` (keys), `/mcp`. |
| `src/curator/` | The Curator on Pi Durable: review, briefing, upkeep, chat. The only module that imports it. |
| `src/cli/` | `rs`, the command line for people and agents (a thin client). |
| `src/web/`, `web/` | The web app (SvelteKit, phone-first) and the service it talks through. |
| `integrations/hermes-plugin/` | The Hermes plugin. |
| `evals/curator/` | The Curator's test set, run against a real model. |
| `docs/` | Design and deploy notes. |

## Run it on your machine

Needs Node 26 or newer. Nothing else.

```sh
npm ci && npm run build
node src/local.ts            # opens http://127.0.0.1:4390; from this machine nobody signs in
```

First run asks for the company's name and, if you want the Curator, a Fireworks key. Add agents and
their keys in Admin, then `rs init --server http://127.0.0.1:4390 --company SLUG --key-file FILE`.
`--tailnet` lets every device on your Tailscale network in without signing in. Details:
[docs/deploy/local.md](docs/deploy/local.md), which also covers running it for a team (everyone signs in).
`npm test` (after `npm run build`) runs the type-check and the tests in seconds. Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
