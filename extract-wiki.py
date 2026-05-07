#!/usr/bin/env python3
"""
extract-wiki.py — Reads Warframe wiki parquet dataset and outputs
curated, cleaned JSON files for the Node.js transform pipeline.

Dataset: HuggingFace `LLukas22/wf-wiki`
  Clone:   git clone https://huggingface.co/datasets/LLukas22/wf-wiki data/wf-wiki
  Refresh: git -C data/wf-wiki pull

Usage:  python3 extract-wiki.py
Input:  data/wf-wiki/latest/*.parquet
Output: data/wiki-lore.json        data/wiki-quests.json
        data/wiki-factions.json     data/wiki-open-worlds.json
        data/wiki-mechanics.json    data/wiki-damage-types.json
        data/wiki-game-systems.json data/wiki-endgame.json
        data/wiki-companions.json   data/wiki-modular.json
"""

import json
import os
import re
import sys

import mwparserfromhell
import pandas as pd

WIKI_DIR = os.path.join("data", "wf-wiki", "latest")
OUT_DIR = "data"

# ── Page lists ────────────────────────────────────────────────────────────────

LORE_CHARACTERS = [
    "Ballas", "Teshin", "Margulis", "Ordis", "Lotus", "Natah", "Hunhow",
    "Erra", "The Man in the Wall", "Varzia", "Konzu", "Eudico", "Little Duck",
    "Nora Night", "Cephalon Simaris", "Cephalon Suda", "Darvo", "Ticker",
    "Grandmother", "Albrecht Entrati", "Loid", "Acrithis",
    "Kahl-175", "Veso", "Fibonacci", "Chipper", "Dax",
    "Orokin", "Tenno", "Ostron", "Solaris United", "Entrati",
    "Cephalon Cy", "Archimedean Yonta",
    "Jade Shadows", "Arthur", "Stalker",
]

QUEST_PAGES = [
    "Quest",
    "Vor's Prize", "Once Awake", "The Archwing", "Stolen Dreams",
    "The New Strange", "Natah (Quest)", "The Second Dream",
    "The War Within", "Chains of Harrow", "Apostasy Prologue",
    "The Sacrifice", "Chimera Prologue", "Erra (Quest)",
    "The Maker", "Rising Tide",
    "The New War", "Angels of the Zariman", "The Duviri Paradox",
    "Whispers in the Walls", "1999", "The Lotus Eaters",
    "Jade Light",
    "Heart of Deimos", "Vox Solaris (Quest)", "Saya's Vigil",
    "The Deadlock Protocol", "Call of the Tempestarii",
    "Waverider", "The Jordas Precept", "Patient Zero",
    "Hidden Messages", "Howl of the Kubrow", "A Man of Few Words",
    "The Glast Gambit", "Octavia's Anthem", "The Silver Grove",
    "The Limbo Theorem", "Mask of the Revenant",
]

FACTION_PAGES = [
    "Grineer", "Corpus", "Infested", "Sentient", "Orokin",
    "Corrupted", "Narmer", "Techrot",
]

OPEN_WORLD_PAGES = [
    "Plains of Eidolon", "Cetus", "Orb Vallis", "Fortuna",
    "Cambion Drift", "Necralisk", "Duviri", "Zariman Ten Zero",
    "Conservation", "Mining", "Fishing",
]

MECHANIC_PAGES = [
    "Damage", "Damage/Calculation",
    "Armor", "Shield", "Health", "Status Effect", "Critical Hit",
    "Affinity", "Mastery Rank", "Stealth", "Focus",
    "Helminth", "Endo", "Stance",
    "Ability Duration", "Ability Efficiency", "Ability Range",
    "Energy Capacity", "Mod", "Arcane Enhancement",
    "Void Relic", "Forma", "Abilities", "Enemy Level Scaling",
    "Aura", "Corrupted Mods", "Nightmare Mode", "Exalted Weapon",
]

DAMAGE_TYPE_PAGES = [
    "Damage/Impact Damage", "Damage/Puncture Damage", "Damage/Slash Damage",
    "Damage/Heat Damage", "Damage/Cold Damage", "Damage/Electricity Damage",
    "Damage/Toxin Damage",
    "Damage/Blast Damage", "Damage/Corrosive Damage", "Damage/Gas Damage",
    "Damage/Magnetic Damage", "Damage/Radiation Damage", "Damage/Viral Damage",
    "Damage/Void Damage", "Damage/True Damage",
    "Damage/Tau Damage",
]

GAME_SYSTEMS_PAGES = [
    "Trading", "Platinum", "Credits",
    "Incarnon", "Prime", "Void Fissure", "Void",
    "Operator", "Transference (Lore)",
    "Orbiter", "Landing Craft", "Codex", "Simulacrum",
    "Parazon", "Clan",
]

ENDGAME_PAGES = [
    "The Steel Path", "Arbitrations", "Sanctuary Onslaught",
    "Disruption", "The Index",
    "Kuva Lich/Main", "Empyrean",
    "Profit-Taker Orb", "Eidolon",
]

COMPANION_PAGES = [
    "Kubrow", "Kavat", "Sentinel",
]

MODULAR_PAGES = [
    "Amp", "Zaw", "Kitgun", "K-Drive", "Necramech",
]


# ── Parsing ───────────────────────────────────────────────────────────────────

# Templates that should resolve to a specific positional parameter index (1-based).
# These are the most common Warframe wiki templates. The display text we want
# is usually in the first numbered parameter, sometimes the second when the
# first is a category/icon key.
_TEMPLATE_PARAM = {
    # Item/entity links — display text is param 1
    "m": 1, "mod": 1, "wf": 1, "warframe": 1, "weapon": 1, "w": 1,
    "a": 1, "ability": 1, "arcane": 1, "stat": 1, "d": 1, "damage": 1,
    "ll": 1, "p": 1, "primed": 1, "u": 1, "i": 1, "item": 1,
    "enemy": 1, "faction": 1, "boss": 1, "quest": 1, "syn": 1, "syndicate": 1,
    "loc": 1, "node": 1, "planet": 1, "tileset": 1, "mission": 1,
    "fish": 1, "res": 1, "resource": 1, "gem": 1, "key": 1, "relic": 1,
    "color": 1, "sc": 1,  # standing
    "plat": 1, "credits": 1, "endo": 1,
    # Icon/Color templates: "{{Icon|Energy|Energy Orb}}" → param 2
    "icon": 2, "iconlink": 2,
    # Version templates: "{{ver|34.0}}" → "Update 34.0"
    "ver": 1, "update": 1,
}

# Templates whose entire content should be discarded (navigation/meta only).
_TEMPLATE_DISCARD = {
    "modbox", "weaponbox", "warframebox", "infobox", "scrollbox/article",
    "scrollbox", "clr", "clear", "droplocations", "navbox", "tabber",
    "navigation", "tabview", "tab", "main", "see also", "stub",
    "redirect", "for", "about", "construction", "delete", "merge",
    "citation needed", "fact", "category", "spoiler", "languages",
}


def _resolve_template(tpl):
    """Return replacement text for a wiki template, or '' to discard it."""
    name = str(tpl.name).strip().lower()
    # Strip subpage suffix like "scrollbox/article" — match either way
    if name in _TEMPLATE_DISCARD:
        return ""
    if name == "basepagename":
        return ""  # caller substitutes page title via context if needed
    idx = _TEMPLATE_PARAM.get(name)
    if idx is not None:
        try:
            param = tpl.get(idx).value.strip_code().strip()
            # Version template: prefix with "Update "
            if name in ("ver", "update") and param:
                return f"Update {param}"
            # Standing currency
            if name == "sc" and param:
                return f"{param} Standing"
            if name == "plat" and param:
                return f"{param} Platinum"
            if name == "credits" and param:
                return f"{param} Credits"
            if name == "endo" and param:
                return f"{param} Endo"
            return param
        except (ValueError, IndexError):
            return ""
    # Unknown template: keep last positional param if any (often the display text)
    try:
        params = [p for p in tpl.params if not p.showkey]
        if params:
            return params[-1].value.strip_code().strip()
    except Exception:
        pass
    return ""


def _resolve_templates(wikicode, page_title=""):
    """Walk a parsed wikicode tree, replacing templates with their display text."""
    for tpl in list(wikicode.ifilter_templates(recursive=True)):
        # Recurse into template params first so nested templates resolve
        try:
            for p in tpl.params:
                _resolve_templates(p.value, page_title)
        except Exception:
            pass
        replacement = _resolve_template(tpl)
        # BASEPAGENAME special-case: substitute the page title
        if str(tpl.name).strip().lower() == "basepagename":
            replacement = page_title
        try:
            wikicode.replace(tpl, replacement)
        except ValueError:
            # Template was already removed by a parent recursion
            pass


def clean_wikitext(raw, page_title=""):
    """Convert MediaWiki wikitext to clean plaintext for AI consumption."""
    # Pre-strip onlyinclude/noinclude/includeonly wrapper tags
    raw = re.sub(r"</?(?:onlyinclude|noinclude|includeonly)[^>]*>", "", raw)

    # Remove gallery blocks before parsing — they hold image data
    raw = re.sub(r"<gallery[^>]*>.*?</gallery>", "", raw, flags=re.DOTALL | re.IGNORECASE)
    # Remove ref blocks
    raw = re.sub(r"<ref[^>]*/>", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<ref[^>]*>.*?</ref>", "", raw, flags=re.DOTALL | re.IGNORECASE)

    # Remove wiki tables wholesale — they convert to garbage and the
    # structured data is already in items-*.json. Match nested {| ... |}.
    raw = _remove_wiki_tables(raw)

    # Strip ORPHAN wikitable row syntax (tables that weren't wrapped in {|...|}).
    # Drop any line beginning with |+, |-, !, or matching | data-... | cell syntax.
    raw = re.sub(r"^\s*\|\+.*$", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"^\s*\|\-.*$", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"^\s*!.*$", "", raw, flags=re.MULTILINE)
    # Lines that are clearly table rows: contain " || " or start with "| data-..."
    raw = re.sub(r"^\s*\|\s*data-[a-z\-]+=.*$", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"^\s*\|.* \|\| .*$", "", raw, flags=re.MULTILINE)
    # Single-cell orphan table rows: a line beginning with "| " (one pipe).
    # Wikitext cell rows from tables that survived the {| ... |} extractor.
    raw = re.sub(r"^\s*\|\s+(?!\|).*$", "", raw, flags=re.MULTILINE)

    parsed = mwparserfromhell.parse(raw)

    # Resolve known templates to their display text BEFORE strip_code()
    _resolve_templates(parsed, page_title)

    text = parsed.strip_code()

    # Remove navigation/meta lines
    text = re.sub(r"^For the update of the same name.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^See also:.*$", "", text, flags=re.MULTILINE)

    # Remove file/image references that survived
    text = re.sub(r"\[\[File:[^\]]*\]\]", "", text)
    text = re.sub(r"\[\[Image:[^\]]*\]\]", "", text)

    # Remove any remaining template residue (well-formed and malformed)
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    # Malformed single-brace close: {{...} (missing one }) — strip up to end of line
    text = re.sub(r"\{\{[^{}\n]*\}?", "", text)
    # Stray placeholder tokens left from gutted templates
    text = re.sub(r"^\s*usage-checklist\s*$", "", text, flags=re.MULTILINE)

    # Remove tabview artifacts (Name=\n|-|Variant=)
    text = re.sub(r"^[A-Za-z' -]+=\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\|-\|[A-Za-z' -]+=\s*$", "", text, flags=re.MULTILINE)

    # Remove Category: lines
    text = re.sub(r"^Category:[^\n]*$", "", text, flags=re.MULTILINE)

    # Clean up HTML entities
    text = text.replace("&ndash;", "–").replace("&mdash;", "—")
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    text = text.replace("&#9;", "")

    # Remove HTML tags
    text = re.sub(r"<[^>]+>", "", text)

    # Remove bare URLs
    text = re.sub(r"https?://\S+", "", text)

    # Remove /Lotus/ paths
    text = re.sub(r"/Lotus/[^\s|)}\]]+", "", text)

    # Clean __TOC__ and similar
    text = re.sub(r"__[A-Z]+__", "", text)

    # Remove localization/translation lines (de:..., es:..., fr:..., etc.)
    text = re.sub(r"^(?:de|es|fr|ru|uk|ja|ko|pt|pl|it|tc|th|tr|zh):.+$", "", text, flags=re.MULTILINE)

    # Remove orphan possessives from stripped wikilinks (" 's " → " ")
    text = re.sub(r" 's ", " ", text)
    text = re.sub(r" 's\.", ".", text)
    text = re.sub(r" 's,", ",", text)
    text = re.sub(r" 's$", "", text, flags=re.MULTILINE)

    # Clean orphan comma sequences from stripped wikilink lists
    text = re.sub(r" (?:, ){2,}", " ", text)
    text = re.sub(r", ,", ",", text)
    text = re.sub(r"^, ", "", text, flags=re.MULTILINE)
    text = re.sub(r" , \.", ".", text)

    # Fix double spaces left from removed templates
    text = re.sub(r"  +", " ", text)
    # Fix " ," → ","
    text = re.sub(r" ,", ",", text)
    # Fix " ." → "."
    text = re.sub(r" \.", ".", text)
    # Fix orphan "''" italics markers that survived
    text = text.replace("''", "")

    # Drop orphan numeric-only lines (stranded image thumbnail widths like "220",
    # "150", or page-numbers from collapsed wiki tables/galleries). A line that
    # is nothing but digits carries no retrievable fact for the model.
    text = re.sub(r"^\s*\d{1,4}(?:px)?\s*$", "", text, flags=re.MULTILINE)

    # Collapse excessive whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"^\s+$", "", text, flags=re.MULTILINE)

    return text.strip()


def _remove_wiki_tables(text):
    """Remove MediaWiki '{| ... |}' tables, including nested ones."""
    out = []
    i = 0
    n = len(text)
    while i < n:
        if text[i:i+2] == "{|":
            # Find matching |}, accounting for nesting
            depth = 1
            j = i + 2
            while j < n and depth > 0:
                if text[j:j+2] == "{|":
                    depth += 1
                    j += 2
                elif text[j:j+2] == "|}":
                    depth -= 1
                    j += 2
                else:
                    j += 1
            i = j
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def extract_pages(main_df, titles):
    """Extract and clean a list of pages by exact title."""
    results = []
    for title in titles:
        rows = main_df[main_df.title == title]
        if len(rows) == 0:
            print(f"  WARN: page not found: {title}", file=sys.stderr)
            continue
        wt = rows.iloc[0].wikitext
        cleaned = clean_wikitext(wt, page_title=title)
        if len(cleaned) < 50:
            print(f"  SKIP: {title} (too short after cleaning: {len(cleaned)} chars)", file=sys.stderr)
            continue
        results.append({"title": title, "content": cleaned})
    return results


def truncate_wiki(text, max_chars=2000):
    """Truncate wiki text to a sensible length for enrichment, cutting at paragraph."""
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    # Try to cut at last paragraph break
    last_para = cut.rfind("\n\n")
    if last_para > max_chars // 2:
        return cut[:last_para].rstrip()
    # Otherwise cut at last sentence
    last_dot = cut.rfind(". ")
    if last_dot > max_chars // 2:
        return cut[:last_dot + 1].rstrip()
    return cut.rstrip()


def extract_enrichment(main_df):
    """Build enrichment lookup from wiki for all game items."""
    enrichment = {}

    def add(name, wiki_title, use_main=False):
        """Try to extract wiki content for an item. Returns True if found."""
        lookup = f"{wiki_title}/Main" if use_main else wiki_title
        rows = main_df[main_df.title == lookup]
        if len(rows) == 0 and use_main:
            # Fall back to direct page
            rows = main_df[main_df.title == wiki_title]
        if len(rows) == 0:
            # Try Name/Prime for Prime variants
            if " Prime" in wiki_title:
                base = wiki_title.replace(" Prime", "")
                rows = main_df[main_df.title == f"{base}/Prime"]
            if len(rows) == 0:
                return False
        wt = rows.iloc[0].wikitext
        cleaned = clean_wikitext(wt, page_title=name)
        if len(cleaned) < 80:
            return False
        enrichment[name] = truncate_wiki(cleaned)
        return True

    # --- Warframes (use /Main subpages) ---
    wf_data = load_json("items-Warframes.json")
    if wf_data:
        found = 0
        for item in wf_data:
            if add(item["name"], item["name"], use_main=True):
                found += 1
        print(f"  Warframes: {found}/{len(wf_data)} enriched")

    # --- Primary/Secondary/Melee weapons (direct pages) ---
    for cat, label in [("items-Primary.json", "Primary"), ("items-Secondary.json", "Secondary"),
                       ("items-Melee.json", "Melee"), ("items-Arch-Gun.json", "Arch-Gun"),
                       ("items-Arch-Melee.json", "Arch-Melee")]:
        data = load_json(cat)
        if not data:
            continue
        found = sum(1 for item in data if add(item["name"], item["name"]))
        print(f"  {label}: {found}/{len(data)} enriched")

    # --- Companions (sentinels use /Main, others direct) ---
    sent_data = load_json("items-Sentinels.json")
    if sent_data:
        found = sum(1 for item in sent_data if add(item["name"], item["name"], use_main=True))
        print(f"  Sentinels: {found}/{len(sent_data)} enriched")

    pets_data = load_json("items-Pets.json")
    if pets_data:
        found = sum(1 for item in pets_data if add(item["name"], item["name"]))
        print(f"  Pets: {found}/{len(pets_data)} enriched")

    # --- Mods (direct pages) ---
    mod_data = load_json("items-Mods.json")
    if mod_data:
        found = sum(1 for item in mod_data if add(item["name"], item["name"]))
        print(f"  Mods: {found}/{len(mod_data)} enriched")

    # --- Arcanes (direct pages) ---
    arc_data = load_json("items-Arcanes.json")
    if arc_data:
        found = sum(1 for item in arc_data if add(item["name"], item["name"]))
        print(f"  Arcanes: {found}/{len(arc_data)} enriched")

    # --- Resources (direct pages) ---
    res_data = load_json("items-Resources.json")
    if res_data:
        found = sum(1 for item in res_data if add(item["name"], item["name"]))
        print(f"  Resources: {found}/{len(res_data)} enriched")

    # --- Misc items (direct pages — includes common resources like Argon Crystal) ---
    misc_data = load_json("items-Misc.json")
    if misc_data:
        found = sum(1 for item in misc_data if add(item["name"], item["name"]))
        print(f"  Misc: {found}/{len(misc_data)} enriched")

    # --- Fish (direct pages) ---
    fish_data = load_json("items-Fish.json")
    if fish_data:
        found = sum(1 for item in fish_data if add(item["name"], item["name"]))
        print(f"  Fish: {found}/{len(fish_data)} enriched")

    # --- Enemies (direct pages) ---
    enemy_data = load_json("items-Enemy.json")
    if enemy_data:
        found = sum(1 for item in enemy_data if add(item["name"], item["name"]))
        print(f"  Enemies: {found}/{len(enemy_data)} enriched")

    # --- Quests (direct pages) ---
    quest_data = load_json("items-Quests.json")
    if quest_data:
        found = sum(1 for item in quest_data if add(item["name"], item["name"]))
        print(f"  Quests: {found}/{len(quest_data)} enriched")

    # --- Archwings (use /Main) ---
    aw_data = load_json("items-Archwing.json")
    if aw_data:
        found = sum(1 for item in aw_data if add(item["name"], item["name"], use_main=True))
        print(f"  Archwings: {found}/{len(aw_data)} enriched")

    # --- Railjack (direct pages) ---
    rj_data = load_json("items-Railjack.json")
    if rj_data:
        found = sum(1 for item in rj_data if add(item["name"], item["name"]))
        print(f"  Railjack: {found}/{len(rj_data)} enriched")

    # --- Relics (direct pages) ---
    relic_data = load_json("items-Relics.json")
    if relic_data:
        found = sum(1 for item in relic_data if add(item["name"], item["name"]))
        print(f"  Relics: {found}/{len(relic_data)} enriched")

    return enrichment


def load_json(filename):
    """Load a JSON file from data/ directory, return None if missing."""
    path = os.path.join(OUT_DIR, filename)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # Load all parquet files
    parquet_dir = WIKI_DIR
    if not os.path.isdir(parquet_dir):
        print(f"ERROR: {parquet_dir} not found. Clone the dataset first.", file=sys.stderr)
        sys.exit(1)

    print("Loading parquet files...")
    dfs = []
    for f in sorted(os.listdir(parquet_dir)):
        if f.endswith(".parquet"):
            dfs.append(pd.read_parquet(os.path.join(parquet_dir, f)))
    df = pd.concat(dfs, ignore_index=True)

    # Filter to main namespace, non-redirect
    main = df[(df.namespace_id == 0) & (~df.is_redirect)].copy()
    print(f"  {len(main)} main namespace articles loaded")

    # Extract each category
    categories = {
        "wiki-lore.json": ("Lore Characters", LORE_CHARACTERS),
        "wiki-quests.json": ("Quests", QUEST_PAGES),
        "wiki-factions.json": ("Factions", FACTION_PAGES),
        "wiki-open-worlds.json": ("Open Worlds", OPEN_WORLD_PAGES),
        "wiki-mechanics.json": ("Game Mechanics", MECHANIC_PAGES),
        "wiki-damage-types.json": ("Damage Types", DAMAGE_TYPE_PAGES),
        "wiki-game-systems.json": ("Game Systems", GAME_SYSTEMS_PAGES),
        "wiki-endgame.json": ("Endgame Activities", ENDGAME_PAGES),
        "wiki-companions.json": ("Companions", COMPANION_PAGES),
        "wiki-modular.json": ("Modular Equipment", MODULAR_PAGES),
    }

    for filename, (label, titles) in categories.items():
        print(f"\nExtracting {label} ({len(titles)} pages)...")
        pages = extract_pages(main, titles)
        out_path = os.path.join(OUT_DIR, filename)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(pages, f, ensure_ascii=False, indent=2)
        total_chars = sum(len(p["content"]) for p in pages)
        print(f"  -> {out_path}: {len(pages)} pages, {total_chars:,} chars")

    # Extract enrichment data for all game items
    print(f"\nExtracting item enrichment...")
    enrichment = extract_enrichment(main)
    enrich_path = os.path.join(OUT_DIR, "wiki-enrichment.json")
    with open(enrich_path, "w", encoding="utf-8") as f:
        json.dump(enrichment, f, ensure_ascii=False, indent=2)
    total_chars = sum(len(v) for v in enrichment.values())
    print(f"  -> {enrich_path}: {len(enrichment)} items, {total_chars:,} chars")

    print("\nDone.")


if __name__ == "__main__":
    main()
