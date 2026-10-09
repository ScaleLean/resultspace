# ResultSpace UI

The rules every screen follows. If a screen needs something this file does not cover, add it here first.

## Who it is for, and what the content is really like

One owner running several companies, each with its own agent, mostly on a phone, for 30-90 seconds several
times a day, checking two things across all of them: **what needs me** and **what got done**. The content is
written by agents: long, dense lines full of ids, amounts and keys ("Ads 1234567890: removed 12 paused
legacy Shopping/PMax campaigns on retired Merchant 987654321 after MCP commit 3f2a9c1; readback REMOVED each.
Alex approved Oct 6. Total removed today: 28."). The UI's main job is to make that scannable without losing
any of it.

## Shape

- **Home (`/`) covers every company.** The headline is the answer ("2 things need you" / "You're caught up."),
  not a greeting. Then: Needs you (acted on in place: approve, reply, close), What got done (each busy company's
  few meaningful entries, its machine work folded into one telemetry line with a 7-day activity strip), Agents
  (every company's agent: working now / last active / quiet since). One company: Home goes straight into it.
- **Machine work is counted, not shown.** Sessions and raw commands logged as actions (`isMachine` in
  src/operations/views.ts) stay out of Home, Overview and Journal "All"; they are one line ("4h 08m worked ·
  35 sessions · 11 with errors") and a filter away.
- **A company is its agent.** Its Overview opens with the agent's state and focus, then the same telemetry.
- Data: `pulse.get` (one read per company) feeds Home and the rail.

## Principles

1. **Headline, then detail.** Agent text is never shown whole as a bold title. It is split into an optional
   context ("Ads 1234567890"), a headline (the first clause, plain weight 500) and the rest (dim, two lines,
   expands on tap). Nothing is cut off for good: the whole text is one tap away.
2. **Who did it is a face, not a string.** Actors are an avatar and a short name: `hermes:acme`
   in Acme is "Agent"; elsewhere "Acme agent". The Curator is violet with a spark.
   People by first name.
3. **Type is an icon and a colour, not a word.** Outcome: green check. Action (outward): amber arrow.
   Session: grey terminal. Note: blue pen. The same four everywhere.
4. **Quiet when there is nothing.** Empty states are one calm line, not a dashed box. "Nothing needs you" is
   good news and looks like it.
5. **Say the summary.** Lists open with what they add up to ("18 actions and 3 outcomes since this morning").
6. **Time is grouped, not repeated.** Lists of events are grouped by day ("Today", "Yesterday", "Mon 5 Oct");
   rows show the clock time, not "6h ago" on every line.
7. **Finished things step back.** Completed projects, done tasks and old history are folded, with a count.
8. **One action per card, big and obvious.** Approve/Decline are the largest things on a request; nothing else
   on the card competes.
9. **Phone first, desktop uses its width.** On a desktop, Today is two columns (what happened | what needs you,
   open work) and content sits next to the rail, not centred in empty space.
10. **Plain words.** No "entity", no "payload", no "revision" outside History.

## Tokens

- Type: Inter (variable, bundled). Sizes 12 · 13 · 14 · 15 (body) · 17 · 20 · 30-40 (page answer). Numbers tabular.
  Weights: 400 body, 500 headline, 600 titles, 700 only for counts and the page title.
- Space: 4 · 8 · 12 · 16 · 20 · 24 · 32. Radius: 8 (controls), 12 (cards), 999 (pills).
- One theme: a dark, precise console. Teal = an agent at work and the accent; amber = needs you and outward
  actions; red = failure; violet = the Curator; blue = notes. Hairlines, not shadows; radius 6-8.
- Mono (JetBrains Mono, bundled) only for ids, times, telemetry and small uppercase labels (`.label-mono`).
- Tap targets 44px. Focus ring visible. Motion under 200 ms and off when the device asks.

## Components (web/lib)

- `Shell`: the frame. Rail: Home, then every company (live dot or a count of what waits); the open company
  unfolds into its sections. Phone: top bar (back to Home inside a company), tab bar inside a company.
- `NeedItem`: one thing that waits (request, question, flag) with its action in place.

- `Avatar` and `actor()`: face and short name for any actor string.
- `TypeIcon`: the four Journal types, plus record kinds.
- `Headline`: context · headline · rest, with clamp and expand.
- `EntryRow`: one Journal entry (icon, headline, meta line: avatar, project, time).
- `DayGroups`: groups dated rows under day headers.
- `Prose`: long text as readable paragraphs (keys linked, paths shortened, clamped after N lines).
- `Stat`: a number with its label, for summary strips.
- `RecRow`: one record as a row (kind icon, title, status, meta).
