# Experimental Research tab

Enable **Settings → Experimental features → Research**. The flag is off by default and stored per browser, like Reel editor. Both desktop and mobile navigation use it. The authenticated API also requires the opt-in header; this is a UI experiment, not an authorization boundary.

Research takes a topic, platform and one of claude-carousel's three themes. It uses web search to collect evidence, generates structured slide copy, performs an independent content audit, escapes copy into upstream HTML templates, and renders with the upstream strict layout validator. Invalid copy or citations receive up to two correction attempts using validation feedback. Failed audits return an error rather than releasing unchecked slides. Results include previews and a ZIP of PNGs, HTML, caption and sources. Results are not saved as calendar posts; download before navigating away.

## API server setup

Python 3.10+ is required in addition to the existing Node runtime:

```sh
python3 -m venv .venv-research
.venv-research/bin/pip install -r research-requirements.txt
.venv-research/bin/python -m playwright install --with-deps chromium
```

The backend automatically uses `.venv-research/bin/python` when installed. Set `RESEARCH_PYTHON` only to override that location. Existing OpenAI and S3 configuration is required. Optional `RESEARCH_SEARCH_MODEL` and `RESEARCH_CAROUSEL_MODEL` default to `gpt-5.6-terra`; the search model must support the Responses web_search tool. No API keys belong in the browser. Provision a system sans-serif font in the server image. Remote fonts are removed for offline, deterministic rendering.

The API allows one active generation per user per Node process. A shared queue/rate limit is needed before scaling the experiment across API instances. Requests can take several minutes; the reverse proxy must allow long-running requests. Search and generation incur model usage charges. Uploaded outputs use the existing project media storage and signed-link expiry.

Upstream version and MIT attribution: `vendor/claude-carousel/UPSTREAM.md` and `LICENSE`.

Tests: `node --test test/research*.test.js`; upstream rendering tests: `python -m pytest vendor/claude-carousel/carousel/tests/` after installing pytest in the render environment.

## Brand Kit and debug calls

Research loads the current account's saved Brand Kit, including the selected color set, heading/body/detail fonts, logo and its corner, and selected background. Built-in fonts are fetched from the same Fontshare/Google font providers as the app, cached in the API process, and embedded in the exported HTML. Saved logos/backgrounds are loaded from the current user's media and embedded. A connected account without custom settings uses Brand Kit defaults; no connected account uses the template defaults.

Uploaded fonts still available in the browser session are sent as font bytes (up to 1 MB per selected font). If an old uploaded font is unavailable after a reload, the result explicitly reports an Inter fallback. The chosen template controls layout while Brand Kit controls visual identity. Strict layout/contrast validation still applies to brand colors and backgrounds.

With prompt debugging enabled, every web-search, copy-generation and content-audit call is returned to the existing Prompts panel, including retries and calls preceding a failed run. Entries contain system/input/output, model, elapsed time, token usage and a tentative token-cost estimate using the app's existing pricing calculator. Estimates exclude web-search fees and are not billing totals. Failed calls without usage are marked unavailable. Debug payloads are omitted when debugging is off.
