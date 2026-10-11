<script lang="ts">
  let { kind, body = {} }: { kind: string; body?: Record<string, unknown> } = $props();
  const text = (k: string) => String(body[k] ?? "");
  const fields = $derived(
    (
      {
        project: ["goal", "current_state"],
        knowledge: ["body", "source", "project_id"],
        issue_note: ["detail", "project_id"],
        entry: ["detail", "source", "project_id"],
        source: ["url", "detail"],
        fact: ["subject", "predicate", "scope", "unit", "source", "observed_at", "project_id"],
        flag: ["detail", "suggestion"],
        briefing: ["text"],
        decision: ["choice", "source", "project_id"],
        company: ["name", "brief"],
      } as Record<string, string[]>
    )[kind] ?? [],
  );
</script>

<label class="field"><span>Title</span><input name="title" value={text("title")} required maxlength="300" /></label>
{#if ["project", "issue_note", "flag"].includes(kind)}<label class="field"
    ><span>State</span><select name="status"
      >{#each kind === "project" ? ["planned", "active", "complete", "archived"] : kind === "flag" ? ["open", "fixed", "dismissed"] : ["open", "resolved", "dismissed"] as s}<option
          value={s}
          selected={body.status === s}>{s}</option
        >{/each}</select
    ></label
  >{/if}
{#each fields as k}<label class="field"
    ><span
      >{(
        {
          goal: "Goal",
          current_state: "Current state",
          body: "Learning / knowledge",
          project_id: "Project key (optional)",
          source: kind === "entry" ? "Source or citation (required for learning)" : "Source or citation",
          observed_at: "Observed date (optional)",
          subject: "Subject",
          predicate: "Property",
          scope: "Scope (optional)",
          unit: "Unit (optional)",
        } as Record<string, string>
      )[k] ?? k.replaceAll("_", " ")}</span
    ><textarea name={k} rows={["body", "detail", "current_state"].includes(k) ? 4 : 2}>{text(k)}</textarea></label
  >{/each}
{#if kind === "project"}<label class="field"
    ><span>Objectives (one per line)</span><textarea name="objectives" rows="4"
      >{Array.isArray(body.objectives) ? body.objectives.join("\n") : ""}</textarea
    ></label
  >{/if}
{#if kind === "fact"}<label class="field"
    ><span>Value type</span><select name="value_type"
      >{#each ["text", "number", "boolean"] as t}<option value={t} selected={body.value_type === t}>{t}</option>{/each}</select
    ></label
  ><label class="field"><span>Value (booleans: true or false)</span><input name="value" value={text("value")} required /></label>{/if}
{#if kind === "entry"}<label class="field"
    ><span>Log type</span><select name="type"
      >{#each ["outcome", "learning", "note"] as t}<option value={t} selected={body.type === t}>{t}</option>{/each}</select
    ></label
  >{/if}
{#each ["source_ids", ...(kind === "project" ? ["fact_ids", "knowledge_ids"] : [])] as k}<label class="field"
    ><span
      >{k === "source_ids"
        ? kind === "entry" ? "Source keys (or a citation for learning)" : "Source keys (optional)"
        : k === "fact_ids" ? "Linked fact keys" : "Linked knowledge keys"}</span
    ><input name={k}
      value={Array.isArray(body[k]) ? (body[k] as unknown[]).join(", ") : ""}
    /></label
  >{/each}

<style>
  .field {
    margin: 12px 0;
  }
  textarea,
  input,
  select {
    max-width: 100%;
  }
</style>
