// Every company's pulse (src/operations/views.ts pulseOf), for the home page and the rail. A company the person
// may not read is left out rather than failing the page.
import type { Pulse } from "../../../src/operations/views.ts";
import type { WebService } from "../../../src/web/service.ts";

export type { Pulse };

export function pulses(rs: WebService): Pulse[] {
  const out: Pulse[] = [];
  for (const c of rs.companies()) {
    const r = rs.run<Pulse>(c.slug, "pulse.get");
    if (r.ok) out.push(r.result);
  }
  return out;
}

/** The rail's view of a company: name, whether its agent is working, how many things wait. */
export const railOf = (p: Pulse) => ({ slug: p.slug, name: p.name, needs: p.needs, working: !!p.agent?.working });
export type RailCompany = ReturnType<typeof railOf>;
