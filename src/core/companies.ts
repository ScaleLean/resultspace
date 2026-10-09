// The set of company files in one data directory. Each file is opened once and shared.
import { existsSync, readdirSync } from "node:fs";
import { agentOfKey, slugOfKey, type Actor } from "./agents.ts";
import { Company, companyFile, SLUG } from "./company.ts";
import { invalid } from "./errors.ts";

export class Companies {
  private readonly dir: string;
  private readonly open_ = new Map<string, Company>();

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Slugs of every company file in the data directory. */
  slugs(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.endsWith(".sqlite") && !f.endsWith(".agent.sqlite") && !f.startsWith("_"))
      .map((f) => f.slice(0, -".sqlite".length)).filter((s) => SLUG.test(s)).sort();
  }

  create(slug: string, name: string): Company {
    if (existsSync(companyFile(this.dir, slug))) throw invalid(`company ${slug} already exists`);
    const co = Company.open(this.dir, slug, { name });
    this.open_.set(slug, co);
    return co;
  }

  /** The company's file, or a not-found error. */
  get(slug: string): Company {
    const have = this.open_.get(slug);
    if (have) return have;
    const co = Company.open(this.dir, slug);
    this.open_.set(slug, co);
    return co;
  }

  /**
   * Who a key belongs to. The key names its company, so only that one file is looked in.
   * A bad key, an unknown company and a revoked key all look the same: undefined.
   */
  authenticate(key: string): { company: Company; actor: Actor } | undefined {
    const slug = slugOfKey(key);
    if (!slug || !existsSync(companyFile(this.dir, slug))) return undefined;
    const company = this.get(slug);
    const actor = agentOfKey(company, key);
    return actor ? { company, actor } : undefined;
  }

  close(): void {
    for (const co of this.open_.values()) co.close();
    this.open_.clear();
  }
}
