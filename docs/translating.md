# Translating FeedKeeper

The web interface is available in English, German, Japanese and Russian. Adding or improving a language is a good first contribution, and you do not need to write any application code.

## Improve an existing translation

1. Open the file for the language in `web/src/i18n/locales/` (`en.json`, `de.json`, `ja.json` or `ru.json`).
2. Change the text. Keys (the left side) stay the same.
3. Keep placeholders such as `{{count}}` or `{{name}}` exactly as they are; they are filled in by the app.
4. Open a pull request.

## Add a new language

1. Copy `web/src/i18n/locales/en.json` to `web/src/i18n/locales/<code>.json`, using a [language code](https://www.iana.org/assignments/language-subtag-registry) such as `fr` or `pt-BR`, and translate the values. If your language uses additional `i18next` plural suffixes beyond `_one` and `_other` (such as `_few` and `_many`), include those as well.
2. Register it in `web/src/i18n/index.ts`: import the file, add it to `resources` and to `supportedLngs`.
3. Add it to the list in `web/src/components/LanguageSwitcher.tsx`, labeled in the language itself (for example `Français`).
4. Update the web tests (`web/test/locales.test.mjs`, `web/test/feedError.test.mjs`, `web/test/refreshFeedback.test.mjs`). If your language uses extra plural suffixes, adjust `locales.test.mjs` so it allows them alongside the English reference keys.
5. Localize the built-in starter lists and server messages as well:
   - `server/src/feeds/feedLists.ts` (`SUPPORTED_LANGUAGES`) and `server/src/feeds/feedListsData.ts` (`Localized` entries for list titles, list descriptions, and feed descriptions; keep `FeedListFeedData.title` as a plain `string`, since publication names are not translated), plus `server/test/feedLists.test.ts`.
   - `server/src/oauth/pages.ts` (OAuth sign-in and consent screens) and `server/src/api/push.ts` (`TEST_TEXT` for test notifications).
6. Mention the new language for the web interface in `README.md`.
7. Run `npm run lint` and `npm test`. The locale test fails if your file is missing keys, has unknown ones, or uses inconsistent placeholders.

## Tips

- Check the result in the app: set the language in **Settings > Reading & appearance** and click through the screens that use your text.
- Keep button labels short; many of them sit in narrow mobile layouts.
- Use plural-aware wording where the English text has a count, and ask in your pull request if you are unsure how a string is used.
- A best-effort translation is welcome. Maintainers and other contributors will review it.
