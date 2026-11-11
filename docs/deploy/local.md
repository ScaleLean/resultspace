# Run ResultSpace on your own machine

Needs Node 26 or newer. Nothing else: the database is built into Node.

```sh
git clone https://github.com/ScaleLean/resultspace.git
cd resultspace
npm ci && npm run build
node src/local.ts
```

It prints the address (http://127.0.0.1:4390) and opens it. From this machine nobody signs in: the
browser is the owner. First run asks for the company's name and, if you want the Curator, a Fireworks
API key (https://fireworks.ai, Account → API Keys). Everything except the Curator works without a key.

Data lives in `~/.local/share/resultspace/data`: one SQLite file per company (`<slug>.sqlite`), one
for the Curator's conversations (`<slug>.agent.sqlite`), and `_system.sqlite` for people. Back it up
by copying the directory while the server is stopped, or with `sqlite3 FILE 'vacuum into ...'` while it runs.

## Agents on the same machine

In Admin, add an agent and make its key (shown once; save it to a file with mode 600). Then point the
agent's `rs` at the server:

```sh
rs init --server http://127.0.0.1:4390 --company acme --key-file ~/.config/resultspace/keys/acme.key
rs doctor
rs brief
```

## A team

Every person signs in with their own account, so the record shows who decided what. Run the server
on one machine everyone can reach, with sign-in required for everyone:

```sh
RS_TRUST=none HOST=0.0.0.0 DATA_DIR=~/.local/share/resultspace/data node src/server.ts
```

Make the accounts on the server machine before anyone else can reach it (stop the server first; each
password is read from standard input). Otherwise the first visitor to `/setup` makes the first account.

```sh
export DATA_DIR=~/.local/share/resultspace/data
node src/admin.ts company create acme "Acme"
node src/admin.ts person add alex alex@example.com
node src/admin.ts person add sam sam@example.com
```

Today every person is an admin of every company, and people are added only with `admin.ts`
(the web Admin page manages a single owner account).

`--tailnet` (below) is for one person: everyone on the tailnet comes in as the owner, unsigned.

## Your Tailscale network

```sh
node src/local.ts --tailnet
```

Listens on every interface; requests from your tailnet (100.64.0.0/10, fd7a:115c:a1e0::/48) and from
this machine need no sign-in. Any other address must sign in, and there is no account until you make
one in Admin, so nothing else gets in. Trust is decided from the socket address, never from a header.

## Anywhere else

Hosted on the internet, every request signs in (`RS_TRUST=none`, or simply a host that is not
loopback or tailnet). The `Dockerfile` builds a one-process image (`DATA_DIR=/data`, port 8080). A
public install should still get a second factor and a content security policy, which ResultSpace does
not provide yet: put it behind a VPN (Tailscale) or an authenticating proxy rather than on the open internet.
