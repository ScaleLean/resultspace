#!/usr/bin/env node
// `resultspace`: run ResultSpace on this machine. Data in ~/.local/share/resultspace (or $RS_DATA_DIR),
// the web app on 127.0.0.1:4390, no sign-in from this machine. Use --tailnet to let every device on
// your Tailscale network in without signing in, --host 0.0.0.0 to listen on every interface (then only
// loopback and, with --tailnet, tailnet addresses skip sign-in).
//   resultspace [--port N] [--host ADDR] [--tailnet] [--data DIR] [--no-open]
import { spawn } from "node:child_process";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
if (argv.includes("--help") || argv.includes("-h")) {
  console.log("resultspace [--port N] [--host ADDR] [--tailnet] [--data DIR] [--no-open]\nRuns ResultSpace here. Data: ~/.local/share/resultspace. Then: rs (the command line), node src/admin.ts (operator commands).");
  process.exit(0);
}
const dataDir = flag("--data") ?? process.env.RS_DATA_DIR ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "resultspace", "data");
const host = flag("--host") ?? (argv.includes("--tailnet") ? "0.0.0.0" : "127.0.0.1");
const s = await startServer({ dataDir, port: Number(flag("--port") ?? process.env.PORT ?? 4390), host, trust: argv.includes("--tailnet") ? "tailnet" : "loopback", tick: 60 });
const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${s.port}/`;
console.log(`ResultSpace is running.\n  open:     ${url}\n  data:     ${dataDir}\n  trust:    ${s.trust}${host === "0.0.0.0" ? " (listening on every interface; other addresses must sign in)" : ""}\n  curator:  ${s.curator.available ? "on" : "off until a model key is set in Admin"}\nStop with Ctrl-C.`);
if (!argv.includes("--no-open") && !process.env.CI) {
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  spawn(opener, [url], { stdio: "ignore", detached: true, shell: platform() === "win32" }).on("error", () => undefined).unref();
}
for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => void s.close().then(() => process.exit(0)));
