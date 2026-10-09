// Who gets in without signing in. On a laptop the browser on the same machine is the owner; on a tailnet
// every device is the owner's. Decided from the socket address only, never from a header a client can set.
export type Trust = "loopback" | "tailnet" | "none";

const v4 = (ip: string) => { const m = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip); return m ? m.slice(1).map(Number) as [number, number, number, number] : null; };

export function isLoopback(ip: string): boolean {
  const a = v4(ip);
  return ip === "::1" || (a !== null && a[0] === 127);
}

/** Tailscale hands out 100.64.0.0/10 (CGNAT) and fd7a:115c:a1e0::/48. */
export function isTailnet(ip: string): boolean {
  const a = v4(ip);
  if (a) return a[0] === 100 && a[1] >= 64 && a[1] <= 127;
  return ip.toLowerCase().startsWith("fd7a:115c:a1e0:");
}

export function trusted(remote: string | undefined, trust: Trust): boolean {
  if (!remote || trust === "none") return false;
  return isLoopback(remote) || (trust === "tailnet" && isTailnet(remote));
}

export function parseTrust(s: string | undefined): Trust {
  if (s === "tailnet" || s === "none" || s === "loopback") return s;
  if (s !== undefined && s !== "") throw new Error(`RS_TRUST must be loopback, tailnet or none, not ${s}`);
  return "loopback";
}
