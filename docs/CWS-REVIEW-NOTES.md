# Chrome Web Store · Review Notes (v0.4.0+)

> Internal cheat-sheet for filling out the CWS submission form.
> This document itself is NOT submitted — copy-paste the relevant sections
> into the corresponding justification fields on the developer dashboard.

---

## Single-purpose description

Doc Assistant is a **reading-oriented, bring-your-own-LLM chat sidebar**. It
injects a collapsible side panel on any web page, lets the user converse with
a large language model that they themselves configure (OpenAI / Anthropic /
self-hosted Qwen / Ollama / vLLM / etc.), and uses the current page's extracted
text as conversation context. The extension also maintains a fully local
memory layer (persona, episodic, session-topic, working-memory) in
IndexedDB to make follow-up conversations feel continuous.

---

## Permission justifications

### `activeTab`

Required so that when the user clicks the extension toolbar icon (or the
sidebar open/close trigger), the extension can access the currently active
tab's top-level document to extract the page's readable text as LLM
conversation context. Used only when the user explicitly opens the sidebar;
not used in the background.

### `scripting`

Required to inject the sidebar content script (a Shadow-DOM-isolated React
panel) into the active tab on demand. The extension does not rewrite or
modify the host page beyond mounting its own shadow root; page scripts are
untouched.

### `storage`

Required to persist user configuration (API keys, base URLs, model choices,
conversation preferences) via `chrome.storage.local`. No data is written to
`chrome.storage.sync`, so nothing is uploaded to the user's Google account.

### `alarms`

Required to schedule background reflection jobs (post-PageVisit
summarization, persona-candidate extraction, embedding generation) on a
periodic timer so that work deferred while the tab was busy eventually runs.
These jobs operate only on data the user has already interacted with.

### `contextMenus`

Required to register a right-click menu entry ("Ask Doc Assistant about
this selection / page") so the user can open the sidebar with a specific
page region as context without first opening the sidebar manually.

### `host_permissions: <all_urls>` (broad host permission justification)

**Use this text in the CWS "Broad host permissions" justification field.**

> Doc Assistant is a "bring-your-own-LLM" reading assistant. The user
> configures a custom LLM base URL (OpenAI, Anthropic, Azure OpenAI,
> self-hosted Qwen, Ollama, vLLM, or any OpenAI-compatible endpoint)
> in the options page. We declare `host_permissions: <all_urls>` so that
> the extension can issue `fetch()` requests to whatever base URL the user
> provides — otherwise Chrome's CORS policy would block every LLM call.
>
> Because LLM endpoints are **user-provided** and can point to any domain
> (including private intranet hostnames for self-hosted deployments), it is
> not possible for us to enumerate target hosts ahead of time. `<all_urls>`
> is the minimal declaration that supports this core use case.
>
> The extension does NOT:
>
> - read or transmit any page content in the background; content scripts
>   are injected only after the user explicitly opens the sidebar
> - send network requests to any host other than the user-configured LLM
>   base URL (no analytics, no telemetry, no third-party calls)
> - sync or exfiltrate the user's API key, which is stored exclusively in
>   `chrome.storage.local` on the user's own machine
> - upload the user's conversation history, page extractions, or local
>   memory database (all memory layers live in IndexedDB on-device)
>
> Full privacy policy: see `docs/PRIVACY.md` in the source repository.
> Source code is open for review.

### `content_scripts` matches: `http://*/*`, `https://*/*`

The sidebar needs to be available on any page the user is reading, because
the extension's purpose is reading assistance. The content script is a
passive Shadow-DOM host that does nothing until the user clicks the
toolbar icon or the sidebar trigger — it does not scan page content, send
network requests, or modify the host page on load.

---

## Data usage disclosures (for the "Privacy practices" tab)

- **Personally identifiable information**: No
- **Health information**: No
- **Financial and payment information**: No
- **Authentication information**: Yes — user-provided API keys, stored
  locally only (`chrome.storage.local`), never transmitted anywhere except
  as the `Authorization` header on requests to the user's own configured
  LLM base URL.
- **Personal communications**: Yes (sort of) — conversation messages the
  user types into the sidebar are sent to the LLM base URL the user
  configured. Not collected or processed by the extension developer.
- **Location**: No
- **Web history**: No — page content extracted for the current conversation
  is used as LLM context but not collected; per-visit summaries are stored
  locally in IndexedDB and never uploaded.
- **User activity**: No
- **Website content**: Yes, per the above — current page's readable text is
  extracted locally and sent to the user-configured LLM as conversation
  context when the user sends a message.

Certification checkboxes:

- ☑ I do not sell or transfer user data to third parties outside of the
      approved use cases.
- ☑ I do not use or transfer user data for purposes unrelated to my item's
      single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or
      for lending purposes.

---

## Release checklist (to run when we actually submit)

1. Confirm `apps/extension/manifest.json` `version` matches the tag.
2. `pnpm build:ext` and upload the zipped `apps/extension/dist/`.
3. Paste the broad-host-permission justification above into the form.
4. Paste each per-permission justification above into the form.
5. Link `docs/PRIVACY.md` (raw URL on the public repo) as the privacy
   policy URL.
6. Submit. Expected review time: 1–7 days.

**This submission is not blocking v0.4.0 tag**; run after tag lands.
