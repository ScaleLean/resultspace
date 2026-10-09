// Types every page sees. `locals.rs` is THE way to reach the server (src/web/service.ts); never import runtime code from src/.
import type { IncomingMessage } from "node:http";
import type { WebService } from "../src/web/service.ts";

declare global {
  namespace App {
    interface Locals {
      rs: WebService;
      /** Full `set-cookie` strings (from rs.signIn / rs.setup / rs.signOut). Push one; hooks.server.ts sends it, also on redirects. */
      setCookie: string[];
    }
    interface Platform { req: IncomingMessage & { rs?: WebService } }
  }
}
export {};
