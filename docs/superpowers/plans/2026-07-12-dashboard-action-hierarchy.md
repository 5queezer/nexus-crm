# Dashboard Action Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove repeated Nexus CRM labels and consolidate global and opportunity actions into consistent, responsive control groups.

**Architecture:** Keep `AppHeader` responsible for product navigation while extracting its low-frequency controls into a focused `HeaderUtilityMenu`. Keep dashboard data and handlers in `Dashboard`, but render the opportunity heading and actions through a small `WorkspaceToolbar` so its hierarchy can be tested independently.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Tailwind CSS 4, next-intl, Lucide React, Vitest server-rendered component tests.

## Global Constraints

- Preserve all existing actions, keyboard shortcuts, localization, theming, custom app titles, and responsive behavior.
- Add no dependencies.
- Use “Opportunities” as the home navigation destination label in German and English.
- Keep every toolbar and menu action at least 40px high.
- Keep Settings in primary navigation for administrators; do not duplicate it in the utility menu.
- Do not change opportunity data, filters, metrics, or business rules.

---

### Task 1: Lock the new header hierarchy with regression tests

**Files:**
- Create: `components/__tests__/app-header.test.tsx`
- Modify: `components/app-header.tsx`
- Modify: `messages/de.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `AppHeaderProps` with `user`, optional `shareUrl`, and optional `title`.
- Produces: a header whose brand uses `title || tapp("title")` and whose `/` navigation label uses `tn("opportunities")`.

- [ ] **Step 1: Write the failing header regression test**

Create `components/__tests__/app-header.test.tsx` with stable mocks for `next-intl`, `next/navigation`, and `@/lib/auth-client`. Render `AppHeader` to static markup and assert the product title occurs once and the `/` link is labeled `Opportunities`:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "../app-header";

const translations: Record<string, string> = {
  "app.title": "Nexus CRM",
  "app.eyebrow": "Opportunity OS",
  "nav.opportunities": "Opportunities",
  "nav.documents": "Documents",
  "nav.analytics": "Analytics",
  "nav.resume_ai": "Resume AI",
  "nav.settings": "Settings",
};

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => translations[`${namespace}.${key}`] ?? key,
  useLocale: () => "en",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

describe("AppHeader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders one product brand and names the home destination Opportunities", () => {
    const html = renderToStaticMarkup(
      <AppHeader
        user={{ name: "Chris", email: "chris@example.com", isAdmin: true }}
        shareUrl="https://example.com/share"
      />,
    );

    expect(html.match(/Nexus CRM/g)).toHaveLength(1);
    expect(html).toContain('href="/"');
    expect(html).toContain("Opportunities");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- components/__tests__/app-header.test.tsx`

Expected: FAIL because `nav.opportunities` does not exist and “Nexus CRM” is still used for the home destination.

- [ ] **Step 3: Add only the navigation copy**

Add these keys to both locale files:

```json
"opportunities": "Opportunities"
```

In `AppHeader`, change the home link label to `tn("opportunities")`. Keep the mobile navigation label sourced from the same link object.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- components/__tests__/app-header.test.tsx`

Expected: PASS with one product-title occurrence and an “Opportunities” home destination.

- [ ] **Step 5: Commit the header hierarchy slice**

Stage only the test, header, and locale files. Use the Lore commit intent `Make product identity distinct from workspace navigation`, recording the focused Vitest command under `Tested:`.

---

### Task 2: Build the compact header utility menu

**Files:**
- Create: `components/header-utility-menu.tsx`
- Create: `components/__tests__/header-utility-menu.test.tsx`
- Modify: `components/theme-switcher.tsx`
- Modify: `components/language-switcher.tsx`
- Modify: `components/app-header.tsx`
- Modify: `messages/de.json`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `HeaderUtilityMenu({ user, shareUrl, onLogout })` where `user` contains `name`, `email`, and optional `image`; `onLogout` returns `void | Promise<void>`.
- Produces: one avatar/initial trigger and a portal menu with account identity, optional sharing, full-width theme and language controls, and logout.
- Produces: `ThemeSwitcher({ variant?: "compact" | "menu" })` and `LanguageSwitcher({ variant?: "compact" | "menu" })`, defaulting to `compact` for backward compatibility.

- [ ] **Step 1: Write failing static contract tests**

Create `components/__tests__/header-utility-menu.test.tsx`. Test the exported `HeaderUtilityMenuPanel` directly so progressive disclosure does not hide its content during server rendering:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HeaderUtilityMenuPanel } from "../header-utility-menu";

vi.mock("next-intl", () => ({
  useLocale: () => "de",
  useTranslations: () => (key: string) => ({
    share: "Teilen",
    logout: "Abmelden",
    signed_in_as: "Angemeldet als",
  })[key] ?? key,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("HeaderUtilityMenuPanel", () => {
  it("groups account context and low-frequency global actions", () => {
    const html = renderToStaticMarkup(
      <HeaderUtilityMenuPanel
        user={{ name: "Chris", email: "chris@example.com" }}
        shareUrl="https://example.com/share"
        onLogout={vi.fn()}
      />,
    );

    expect(html).toContain("Chris");
    expect(html).toContain("chris@example.com");
    expect(html).toContain("Teilen");
    expect(html).toContain("Abmelden");
    expect(html).toContain("theme-menu-control");
    expect(html).toContain("language-menu-control");
  });
});
```

Also extend `components/__tests__/app-header.test.tsx` with an assertion for `aria-label="Account and display"`; add `nav.account_menu` to its translation map.

- [ ] **Step 2: Run the panel test and verify RED**

Run: `npm test -- components/__tests__/header-utility-menu.test.tsx`

Expected: FAIL because `HeaderUtilityMenuPanel` and the menu control variants do not exist.

- [ ] **Step 3: Implement menu variants for theme and language**

Add a `variant` prop to each switcher. Preserve current behavior and compact classes. For `variant="menu"`, render a full-width, minimum-40px row and add the stable class hooks used by the test:

```tsx
className={variant === "menu"
  ? "theme-menu-control flex min-h-10 w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.07]"
  : "flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition-all hover:border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-gray-700"
}
```

Use the corresponding `language-menu-control` class in `LanguageSwitcher`.

- [ ] **Step 4: Implement the accessible utility menu and panel**

Add `nav.account_menu`, `nav.signed_in_as`, and any required menu labels in both locales. Create `HeaderUtilityMenuPanel` for the visible menu body and `HeaderUtilityMenu` for disclosure state. Follow the existing `ActionMenu` behavior: portal to `document.body`, close on outside pointer, Escape, and navigation; restore trigger focus on Escape. The panel order must be identity, optional share link, theme, language, separator, logout. Use `role="menu"`, labeled actions, and `min-h-10` targets. Replace the separate share, theme, language, avatar, and logout controls in both desktop and mobile header branches with `HeaderUtilityMenu`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- components/__tests__/header-utility-menu.test.tsx components/__tests__/app-header.test.tsx`

Expected: both test files PASS.

- [ ] **Step 6: Commit the utility menu slice**

Stage only the utility menu, switchers, header integration, locale changes, and their tests. Use the Lore commit intent `Reduce header noise by grouping low-frequency utilities`, with accessibility behaviors under `Directive:` and focused tests under `Tested:`.

---

### Task 3: Consolidate the opportunity workspace controls

**Files:**
- Create: `components/workspace-toolbar.tsx`
- Create: `components/__tests__/workspace-toolbar.test.tsx`
- Modify: `components/dashboard.tsx`

**Interfaces:**
- Consumes: `WorkspaceToolbar({ title, count, viewMode, onViewModeChange, moreMenu, onCreate, createLabel, tableLabel, kanbanLabel })`.
- Produces: one responsive toolbar ordered heading, segmented view selector, overflow menu, primary create action.

- [ ] **Step 1: Write the failing toolbar hierarchy test**

Create `components/__tests__/workspace-toolbar.test.tsx`:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceToolbar } from "../workspace-toolbar";

describe("WorkspaceToolbar", () => {
  it("groups the workspace title, views, overflow, and primary action", () => {
    const html = renderToStaticMarkup(
      <WorkspaceToolbar
        title="Opportunities"
        count={22}
        viewMode="table"
        onViewModeChange={vi.fn()}
        moreMenu={<button type="button">More</button>}
        onCreate={vi.fn()}
        createLabel="New Opportunity"
        tableLabel="Table"
        kanbanLabel="Kanban"
      />,
    );

    expect(html).toContain("Opportunities (22)");
    expect(html.indexOf("Table")).toBeLessThan(html.indexOf("More"));
    expect(html.indexOf("More")).toBeLessThan(html.indexOf("New Opportunity"));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("min-h-10");
  });
});
```

- [ ] **Step 2: Run the toolbar test and verify RED**

Run: `npm test -- components/__tests__/workspace-toolbar.test.tsx`

Expected: FAIL because `WorkspaceToolbar` does not exist.

- [ ] **Step 3: Implement the minimal responsive toolbar**

Create the prop-driven component with a full-width heading on narrow screens and a right-aligned, wrapping action group on larger screens. Use a connected segmented control for table/Kanban, `aria-pressed` on each view button, `min-h-10` on every control, and the existing `nexus-button-primary` class for creation.

- [ ] **Step 4: Integrate the toolbar and remove the duplicate page hero**

In `Dashboard`, delete the standalone block that renders `{customTitle || "Nexus CRM"}`, `tapp("subtitle")`, and the separate create button. Keep the summary metric section first. Replace the old workspace heading/view controls with `WorkspaceToolbar`, passing the current handlers, labels, visible count, and existing `ActionMenu` element.

- [ ] **Step 5: Run focused and full tests**

Run: `npm test -- components/__tests__/workspace-toolbar.test.tsx components/__tests__/app-header.test.tsx components/__tests__/header-utility-menu.test.tsx components/__tests__/action-menu.test.tsx`

Expected: all focused tests PASS.

Run: `npm test`

Expected: the full Vitest suite PASS with zero failures.

- [ ] **Step 6: Commit the workspace toolbar slice**

Stage only the toolbar component/test and dashboard integration. Use the Lore commit intent `Put opportunity decisions and actions in one predictable toolbar`, recording focused and full Vitest runs under `Tested:`.

---

### Task 4: Verify responsive visual hierarchy and project quality gates

**Files:**
- Modify only if visual verdict identifies a concrete defect: `components/app-header.tsx`, `components/header-utility-menu.tsx`, `components/workspace-toolbar.tsx`, or `components/dashboard.tsx`
- Create/Update: `.omx/state/dashboard-ux/ralph-progress.json`

**Interfaces:**
- Consumes: the running dashboard, authenticated seed/dev session, and `/tmp/codex-clipboard-6pO0zg.png` as the annotated reference.
- Produces: desktop and mobile screenshots plus a persisted `visual-verdict` score of at least 90.

- [ ] **Step 1: Run nonvisual quality gates**

Run: `npm run lint`

Expected: exit code 0 with no ESLint errors.

Run: `npx tsc --noEmit`

Expected: exit code 0 with no TypeScript errors.

Run: `npm run build`

Expected: production build completes successfully.

- [ ] **Step 2: Capture desktop and mobile dashboard screenshots**

Start the app on port 3001, load `/` using the existing development authentication path, and capture approximately 1584×892 and 390×844 screenshots. Open the account menu for a second desktop capture to verify its grouping and alignment.

- [ ] **Step 3: Run `visual-verdict` before any visual correction**

Compare the generated screenshots with `/tmp/codex-clipboard-6pO0zg.png`. Persist strict JSON containing `score`, `verdict`, `category_match`, `differences`, `suggestions`, `reasoning`, threshold status, and `next_actions` at `.omx/state/dashboard-ux/ralph-progress.json`.

Expected: score 90 or higher, with one product brand, one Opportunities workspace label, a compact utility trigger, and a single aligned workspace action row.

- [ ] **Step 4: Correct only verdict-backed defects and re-run verification**

If the score is below 90, use the persisted suggestions for one focused CSS/layout edit, rerun the affected tests, recapture screenshots, and rerun `visual-verdict` before making another edit. Stop only when the score reaches at least 90.

- [ ] **Step 5: Commit verified visual refinements**

If Task 4 changed tracked source, commit only those refinements with Lore intent `Finish the dashboard hierarchy against visual evidence`, including the final score and commands under `Tested:`. Do not commit unrelated `.neon`, `.omx`, or `CLAUDE.local.md` files; only the required verdict state may be staged if repository policy expects it.
