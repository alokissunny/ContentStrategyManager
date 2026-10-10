# App languages

Settings → Language switches between English and Spanish immediately. The preference
is stored per browser in `bauhly.locale`, synchronizes across tabs, and falls back
to English for unknown locale IDs or missing messages. Switching does not remount
the app or reset form state. The document language and locale-aware dates follow it.
Posts, account names, prompts, generated designs and other user content retain their
original language. Unknown server error messages use their original text.

## Adding a language

1. Run `npm run i18n:extract` from `frontend` to refresh `locales/en.json`.
2. Copy it to a new locale JSON file and translate the values, preserving every
   `{{placeholder}}`. Keep complete sentences together when interpolation is needed.
3. Import the catalog in `index.jsx` and register its ID, native label and Intl locale
   in `LOCALES` and `catalogs`. It appears in Settings automatically.
4. Extend `scripts/test-locales.cjs` to check the new catalog, then run
   `npm run i18n:check` and `npm run build`.

`build/localize.cjs` localizes authored JSX text, display attributes, static display
metadata, dialogs and locale-aware formatting through Vite's Babel pipeline. It
subscribes React components to the locale store, preserving their existing state.
Routes, option values and API payloads are not translated. Use `translate` explicitly
for display text assembled outside JSX; use `translate="no"` on literal brand marks.
Use full sentences rather than English-specific fragments or plural suffixes.
Server-provided UI enums need explicit entries in the catalog. For arbitrary dynamic
copy, use `translate(text, params)` at the display boundary and `useLocale()` in the
component if it contains no JSX of its own.
