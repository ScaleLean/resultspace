# ResultSpace plugins for Hermes

Two plugins connect a Hermes agent profile to a ResultSpace server.

- `resultspace/` gives the agent the company brief at session start, records outward actions
  (spend, ads, publish, email, prices, deploy and so on) without ever blocking them, sends a short
  activity receipt after tool use, keeps a presence heartbeat while a session is live, and hands
  over assignments (called work orders before ResultSpace schema 3). Its tools are `rs_act` and
  `rs_work` (the tool keeps its old name; it lists, claims and shows assignments).
- `resultspace-memory/` is a Hermes memory provider. It searches ResultSpace records
  (`rs_recall`) and saves durable business facts as `knowledge` records (`rs_remember`).
  It loads `rsclient.py` from the `resultspace/` folder next to it, so install both.

All server calls go through `resultspace/rsclient.py`. It uses only the Python standard library
(Python 3.11 or newer, for `tomllib`).

## Config file

The plugins read the same file as the `rs` command line tool. They look in this order:

1. the path in `$RS_CONFIG`
2. `~/.config/resultspace/profiles/<profile>/cli.toml`
3. `~/.config/resultspace/cli.toml`

The profile is `$RS_PROFILE` when set. Otherwise it is the last part of `$HERMES_HOME` when that
path is `.../profiles/<name>`, and `default` in every other case.

```toml
server_url = "http://127.0.0.1:4390"
default_company = "acme"

[companies.acme]
key_file = "/home/me/.config/resultspace/profiles/acme/acme.key"
```

Each key belongs to one company, so there is one key file per company. A key file must be
private (`chmod 600`), or the client refuses to use it. The file holds only the key. The config
holds only the path. The key is read for each request and is never logged or returned.

A call uses `default_company`. With no default, it uses the only company in the file.

## Install

Copy both folders into the Hermes plugins directory, or into one profile's `plugins/` directory:

```sh
cp -r resultspace resultspace-memory ~/.hermes/plugins/
```

Then restart Hermes. An operator creates the agent and its key on the server:

```sh
node src/admin.ts agent add <company> <agent-name> member
node src/admin.ts agent key <company> <agent-name> --out <key file>
```

## Tests

The tests start the real server from this repository on `127.0.0.1` with a temporary data
directory. They need Node (the version the server uses) and Python 3.11 or newer. They need no
Hermes install and call no remote server.

```sh
cd integrations/hermes-plugin
python3 -m unittest discover -s tests -v
```

- `tests/test_rsclient.py` runs every client call end to end, plus the plugin functions that
  build requests (brief, outward action, remember, recall).
- `tests/test_guard.py` and `tests/test_facts.py` are unit tests of the action classifier and the
  fact filter. They need no server.

## Old routes

The plugin code still calls `client.get("/v1/work")`, `client.post("/v1/ops", ...)` and similar.
`rsclient.py` turns each of these into a `POST /v1/op/<operation>` call and returns the shape the
plugin code reads. New code should call the named methods instead: `brief`, `record_action`,
`receipt`, `presence`, `assignment_list`, `assignment_next`, `assignment_claim`, `assignment_show`,
`search`, `create_record`, or `op(name, input)` for any other operation.

The `assignment_*` methods fall back to the old `work.*` operations on a server from before the
rename. `work_list`, `work_next`, `work_show` and the `/v1/work` routes keep the old names and
shapes (`work_orders`, `work_order`, `results`, `receipts`) until the server drops the `work.*`
aliases; see `docs/design/ASSIGNMENTS.md`. A dispatcher may set `RS_ASSIGNMENT` (old name:
`RS_WORK_ORDER`) to link a run's receipts and actions to one assignment.
