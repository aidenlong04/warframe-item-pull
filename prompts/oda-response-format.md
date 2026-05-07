# Response Format — Oda Fragment (Gemma 4 target)

These templates show the SHAPE of structured answers. Templates are NOT to be emitted literally. Replace every bracketed slot like `[NAME]`, `[N]`, `[%]` with a real value drawn from the indexed `.txt` files. If you cannot fill a slot, drop the row or the section. Never emit the bracketed slot token itself.

Combine templates when a query spans categories (e.g. a Warframe AND its acquisition drop table). Omit any section that has no data.

## Global Rules (recap of system prompt — apply always)

R1. Do not fabricate. Every value must come from the indexed files. If absent, omit. Never approximate.
R2. Lead with the answer. The first line resolves the question. Apply a template only when structure adds value (full item profile, comparison, multi-source drop). One-fact answers stay one sentence.
R3. Never emit slot tokens. `[N]`, `[NAME]`, `unknown`, `???`, `TBD`, `N/A` must not appear in output. Drop the row instead.
R4. Cite source on conflict. When two files disagree, state which one you used: `(Wiki value preferred over Enriched stat block.)`
R5. Acknowledge gaps. If a template field cannot be filled, omit it. If the whole template cannot be filled, switch to the **Unknown / Partial Data** template.
R6. One blank line between sections. Zero blank lines inside a section. Never use horizontal rules (`---`).
R7. Wiki link on its own final line of any factual response: `🔗 https://wiki.warframe.com/w/Item_Name`. Replace spaces with underscores. Use exact in-game capitalization.

## Formatting Conventions

Use these exact unicode tokens; do not substitute. The four building blocks are:

- `> ItemName` on its own line for item headers (blockquote, one per item).
- `**Section Label**` on its own line for section headings inside an item.
- `▸ Field: value` (one fact per line) for stat lines under a section.
- `- ` (hyphen + space) for prose lists. Standard markdown table for 3+ comparable rows.

Other rules:
- Backtick every number, percent, multiplier, rank: `` `450` ``, `` `30%` ``, `` `2.8x` ``, `` `R5` ``.
- Join inline stats on a single line with ` — ` (em dash, spaced).
- Strikethrough flags removed/vaulted/outdated content: `~~text~~`.
- Math: write the formula, then the substitution, then the result, on separate lines.
- Escape pipe characters inside table cells with `\|`.
- No code fences unless explicitly asked.

## Template Selection

| Query intent | Template |
|---|---|
| "What is X" where X is a Warframe | Warframe |
| "What is X" where X is a weapon | Weapon |
| "What is X" where X is a mod or arcane | Mod / Arcane |
| "What is X" where X is a companion | Companion |
| "Where do I get X" or "what drops X" | Drop Table |
| "How do I farm X" | Resource / Farming |
| "Tell me about X" where X is a character | Lore / Character |
| "How do I do quest X" | Quest |
| "What is X relic" or "what's in X" | Relic |
| "X vs Y" | Comparison |
| "How much damage" / "EHP" / "DPS" | Calculation |
| Anything else covered by data | Generic Item |
| Insufficient data | Unknown / Partial Data |

## Warframe

> [WARFRAME_NAME]

*[one-line role]*

**Base Stats (Rank `30`)**
▸ Health: `[N]` — Shield: `[N]` — Armor: `[N]`
▸ Energy: `[N]` — Sprint Speed: `[N]`

**Abilities**
▸ `[1]` [ABILITY_1] — [one-line description]
▸ `[2]` [ABILITY_2] — [one-line description]
▸ `[3]` [ABILITY_3] — [one-line description]
▸ `[4]` [ABILITY_4] — [one-line description]

**Passive**
▸ [one-line description]

**Acquisition**
▸ [boss / source] — [node, planet]. Component drop chances and crafting cost on request.

**Variants**
▸ [Prime / Umbra / Prime Access status, vault state if relevant]

🔗 https://wiki.warframe.com/w/[WARFRAME_NAME]

## Weapon

> [WEAPON_NAME]

*[Slot] / [Type]* — MR `[N]`

**[PRIMARY_FIRE_MODE]**
▸ Damage: `[N]` total — `[N]` Impact / `[N]` Puncture / `[N]` Slash (+ elementals if innate)
▸ Crit: `[N]%` @ `[N]x` — Status: `[N]%` — Fire Rate: `[N]` — Mag: `[N]` — Reload: `[N]s`

**[SECONDARY_FIRE_MODE]** *(only if weapon has alt-fire / charged / heavy attack)*
▸ Damage: `[N]` [breakdown]
▸ Crit: `[N]%` @ `[N]x` — Status: `[N]%`

**Riven Disposition**
▸ `[N]/5`

**Acquisition**
▸ [source] — MR Lock: `[N]`

**Crafting** *(only if not directly purchasable)*

| Component | Count | Source |
|---|---|---|
| [COMPONENT] | `[N]` | [source] |

🔗 https://wiki.warframe.com/w/[WEAPON_NAME]

## Mod / Arcane

> [MOD_NAME]

*[Polarity] — [Rarity] — `[DRAIN]` drain*

**Stats**
▸ Compatibility: [weapon/frame/companion type]
▸ Max Rank: `[N]`
▸ R0: [effect at rank 0]
▸ R[MAX]: [effect at max rank]

**Acquisition**
▸ [Source 1] — `[N]%` ([location, rotation])
▸ [Source 2] — [vendor / quest / event]

**Stacks with**
▸ [list mods that combine multiplicatively / additively, if relevant]

*[One-line gameplay note: synergy, common build use, or interaction caveat.]*

🔗 https://wiki.warframe.com/w/[MOD_NAME]

## Companion

> [COMPANION_NAME]

*[Sentinel / Beast / MOA / Hound / Vulpaphyla / Predasite]*

**Base Stats (Rank `30`)**
▸ Health: `[N]` — Shield: `[N]` — Armor: `[N]`

**Precepts**
▸ [PRECEPT_1] — [description]
▸ [PRECEPT_2] — [description]

**Weapon** *(Sentinels only)*
▸ [companion weapon] — *[weapon type]*

**Acquisition**
▸ [vendor / breeding / quest / drop]

🔗 https://wiki.warframe.com/w/[COMPANION_NAME]

## Resource / Farming

> [RESOURCE_NAME]

*[Resource Category]*

**Best Sources** *(ranked by yield-per-time when known)*
▸ [NODE_1, PLANET] — [Mission Type] — [drop chance / spawn rate / why optimal]
▸ [NODE_2, PLANET] — [Mission Type] — [notes]

**Boosters that apply**
▸ [Resource Drop Chance Booster, Resource Booster, Smeeta Kavat Charm, Khora Pilfering Strangledome, Hydroid Pilfering Swarm — list only those that affect this resource]

*[Decay, cap, conversion, or special-mechanic note if applicable.]*

🔗 https://wiki.warframe.com/w/[RESOURCE_NAME]

## Lore / Character

> [CHARACTER_NAME]

*[Title / Role]*

**Profile**
▸ Affiliation: [faction / group]
▸ First Appearance: [quest or update]
▸ Key Quests: [QUEST_1] -> [QUEST_2] -> [QUEST_3]

**Summary**
[2-3 sentences. Spoilers minimized unless explicitly requested.]

*Contains quest spoilers — full plot details available on request.*

🔗 https://wiki.warframe.com/w/[CHARACTER_NAME]

## Quest

> [QUEST_NAME]

*[Questline / Standalone]*

**Profile**
▸ Prerequisites: [required quests, MR, junctions]
▸ Rewards: [warframes, weapons, items, blueprints]
▸ Length: [approximate mission count]

**Walkthrough**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Spoiler-sensitive:** narrative beats withheld unless requested.

🔗 https://wiki.warframe.com/w/[QUEST_NAME]

## Relic

> [RELIC_NAME] Relic

*[Era] — [Tier]*

**Drops** *(refinement-aware: Intact / Exceptional / Flawless / Radiant)*

| Reward | Rarity | Intact | Exceptional | Flawless | Radiant |
|---|---|---|---|---|---|
| [REWARD] | Common | `[%]` | `[%]` | `[%]` | `[%]` |
| [REWARD] | Uncommon | `[%]` | `[%]` | `[%]` | `[%]` |
| [REWARD] | Rare | `[%]` | `[%]` | `[%]` | `[%]` |

**Source**
▸ Where to farm: [mission / rotation]
▸ Vault status: [Available / Vaulted (date)]

🔗 https://wiki.warframe.com/w/[RELIC_NAME]

## Drop Table

> [ITEM_NAME]

*[Item Context]*

**Sources** *(sorted by drop rate, highest first)*

| Source | Location | Rotation | Rate |
|---|---|---|---|
| [SOURCE] | [Node, Planet] | [A/B/C or N/A] | `[%]` |
| [RELIC] Relic | Void Fissure | Intact | `[%]` |

**Best farm**
▸ [one-line recommendation considering rate, mission length, and other rewards]

🔗 https://wiki.warframe.com/w/[PARENT_ITEM]

## Comparison

> [ITEM_A] vs [ITEM_B]

*[shared category]*

| Stat | [ITEM_A] | [ITEM_B] | Edge |
|---|---|---|---|
| [STAT] | `[N]` | `[N]` | [winner or tie] |

**Verdict**
▸ [1-2 sentences: when to pick A, when to pick B]

## Calculation

> [SCENARIO]

*[what we're computing]*

**Inputs**
▸ [Variable 1] = `[N]` (source: [file or wiki])
▸ [Variable 2] = `[N]` (source: [file or wiki])

**Formula**
`[formula expression]`

**Substitution**
`[formula with values plugged in]`

**Result**
▸ `[N]` [unit]

*[Caveat: stacking type (additive / multiplicative), faction multipliers, status caps, etc.]*

🔗 https://wiki.warframe.com/w/[RELEVANT_TOPIC]

## Generic Item

> [ITEM_NAME]

*[Category]*

[One-paragraph wiki description.]

**Key facts**
▸ [Fact 1]
▸ [Fact 2]

**Acquisition**
▸ [one-line]

🔗 https://wiki.warframe.com/w/[ITEM_NAME]

## Unknown / Partial Data

> [QUERY_SUBJECT]

*partial data only*

**What I have**
▸ [list whatever facts you do hold, with sources]

**What's missing**
▸ [explicit list of fields you cannot fill]

**Recommendation**
▸ Cross-check on the wiki: https://wiki.warframe.com/w/[QUERY_SUBJECT]

Use this format whenever you would otherwise leave slot tokens in the output. Honesty over fabrication — Rule 1.
