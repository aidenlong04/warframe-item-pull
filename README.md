# warframe-item-pull

Warframe data pipeline that produces AI-readable `.txt` bundles for the **Oda Fragment** Discord bot, tuned for **Google Gemma 4**.

## Pipeline

1. `npm run pull` - Fetch raw JSON from community APIs and npm packages into `data/`.
2. `python3 extract-wiki.py` - Extract HuggingFace wiki parquet into `data/wiki-*.json`.
3. `npm run transform` - Convert all JSON into structured `.md` files in `docs/`.
4. `node organize-docs.js` - Bundle `.md` files into ~15 themed `.txt` files (each <= 3 MB).

`npm run update` runs steps 1 and 3. Run wiki extract and organize separately as needed.

## Gemma 4 conventions

The pipeline is tuned for Gemma 4's smaller context window and stricter instruction-following:

- ASCII-only output. No unicode bullets (`▸`, `•`), no `>` blockquote item headers, no `«»` placeholders.
- One `#` title and one description paragraph per `.md` file so the retriever can score it in a single read.
- Inline `Key: value | Key: value` stat lines for token efficiency.
- Markdown tables for repeated structure (drops, recipes, comparisons).
- Aggressive wiki cleanup: Patch History, Gallery, Maximization, See Also, and similar sections are stripped.
- Slot tokens in templates use `[NAME]` (square brackets) - Gemma is more reliable than with `«PLACEHOLDER»`.
- The system prompt (`prompts/oda-fragment.md`) is delivered as the FIRST user turn since Gemma has no system role.

See `.github/copilot-instructions.md` for the full architecture, data sources, and agent workflow.
