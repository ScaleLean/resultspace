# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Set up

Needs Node 26 or newer (and Python 3.11+ for the Hermes plugin tests).

```sh
npm ci
npm run build            # the web app (the web tests need it)
npm test                 # type-check and tests, a few seconds
node src/local.ts        # run it: http://127.0.0.1:4390
```

Hermes plugin: `cd integrations/hermes-plugin && python3 -m unittest discover -s tests -v`.
The Curator's evals (`node evals/curator/run.ts`) call a real model and need `FIREWORKS_API_KEY`;
they are not part of `npm test`.

## Changes

- Keep one company's data inside its own file. Anything that lets one company see another's
  records, agents or keys is a bug (see [SECURITY.md](SECURITY.md) for how to report it privately).
- New operations go in `src/operations/`; the API, MCP, `rs` and the Curator's tools are all made from it.
- Add or update a test with every change, and keep `npm test` passing.
- Never commit keys, data directories or `*.sqlite` files.

By contributing you agree your work is released under the [MIT License](LICENSE).
