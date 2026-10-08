# Extending the web app

A script that runs on the page can customise the web app without patching it: add pages to the settings, add links to the footers, and replace the sign-in form. Typical uses are an operator who has to link a legal notice and a privacy policy, a company that signs users in through its own single sign-on, or a hosted service with pages of its own. A regular installation needs none of this.

The app reads one plain object from `window`. Include the script in the `index.html` you serve, or add it with whatever proxy sits in front of the app.

```js
window.feedkeeperExtensions = window.feedkeeperExtensions ?? {};
const extensions = window.feedkeeperExtensions;

extensions.footerLinks = [/* … */];
extensions.settings = { sections: [/* … */], hidden: [/* … */] };
extensions.loginForm = { mount(container) { /* … */ } };

// Tell the app that something changed.
window.dispatchEvent(new Event("feedkeeper:extensions-changed"));
```

The script may run before or after the app starts: the app reads the object when a page renders and again whenever the event is dispatched. Everything is validated, and an entry that is malformed or not allowed is ignored without affecting the rest.

## Footer links

```js
extensions.footerLinks = [
  { label: { de: "Impressum", en: "Legal notice" }, href: { de: "/impressum", en: "/legal-notice" } },
  { label: "About us", href: "https://example.org/about", newTab: true },
];
```

- Shown under the sign-in card, at the bottom of the account menu and at the end of every settings page. Without links nothing is shown.
- `label` and `href` are either one value or values by language code (`de`, `en`, `ja`, …). The app picks the language it is shown in, then the language without region (`de-AT` → `de`), then English, then the first value.
- `icon` (optional) is a small image shown before the label, an address like the ones below. `placements` (optional) is a list of `"login"`, `"menu"` and `"page"`; without it the link is shown everywhere.
- An address is a page on the same site (`/impressum`) or an `http(s)` URL; anything else, such as `javascript:` or `//host`, is dropped. External addresses open in a new tab. At most eight links, labels up to 60 characters.

## Settings sections

```js
extensions.settings = {
  hidden: ["database"], // built-in sections to hide, by id
  sections: [{
    id: "plan",                        // ?tab=plan: lowercase letters, digits and dashes
    label: "Plan",
    shortLabel: "Plan",                // optional, for the chip row on narrow screens
    description: "Your plan and invoices.",
    group: "Billing",                  // heading in the navigation
    icon: ["M4 6h16M4 12h16M4 18h10"], // optional: path data of a 24×24 stroked icon
    admin: false,                      // true: only administrators see it
    mount(container) {
      container.textContent = "Hello";
      return () => { /* optional cleanup when the section closes */ };
    },
  }],
};
```

- Built-in section ids: `account`, `general`, `filters`, `devices`, `mcp`, `users`, `database`.
- Sections of the host are listed after the built-in ones, under their group heading; groups appear in the order of their first section.
- `mount` receives an empty element each time the section opens. The function it returns runs when the section closes. The section opens through `?tab=<id>`, so links and reloads keep it.
- Entries with a missing field, an invalid or repeated id, the id of a built-in section, or a `mount` that is not a function are ignored. `admin` sections are left out for other users, and `hidden` only affects built-in ids. A `mount` that throws is logged and leaves an empty section.

## Sign-in form

```js
extensions.loginForm = {
  mount(container) {
    container.innerHTML = '<a class="btn-primary" href="/sso/start">Sign in with SSO</a>';
  },
};
```

The app keeps its card with the logo and title and puts the host's content where the email and password form is. The server decides who is signed in, so the content signs the user in through the API (or by redirecting) and reloads the page afterwards. The classes of the app (`input`, `btn-primary`, `btn-secondary`) are available for styling; colours follow the light and dark theme through CSS variables such as `--c-text` and `--c-border`.

## Password card

```js
extensions.passwordCard = {
  // Optional: only replace the card for some users. Without it the card is always replaced.
  applies: async (user) => (await fetch("/sso/status").then((r) => r.json())).noPassword,
  mount(container) {
    container.textContent = "You sign in through your company; there is no password here.";
  },
};
```

The account page shows a card to change the password. A host that signs people in another way can replace it, for everyone or, with `applies`, for those who have no password. While `applies` is pending nothing is shown; if it fails or answers anything but `true`, the built-in card is used.

## Where it lives

`web/src/extensions/host.ts` validates and resolves everything, `useExtensions.ts` re-reads it on every announced change, and the components `SettingsPage.tsx`, `FooterLinks.tsx`, `LoginPage.tsx` and `ProfileMenu.tsx` use it. The unit tests are in `web/test/extensions.test.mjs`.
