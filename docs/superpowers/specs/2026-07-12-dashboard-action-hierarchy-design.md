# Dashboard Action Hierarchy Design

## Context

The opportunities dashboard repeats the configurable application title in three places: the brand block, the active home navigation item, and the page heading. It also distributes related controls across three horizontal groups: global header utilities, the create action, and the workspace view controls. The repetition weakens orientation, while inconsistent button shapes and heights make the interface feel assembled rather than intentional.

## Goals

- Establish one clear brand, navigation, and workspace hierarchy.
- Keep opportunity creation immediately discoverable as the primary action.
- Group controls by scope: global account utilities versus opportunity workspace actions.
- Make button sizing, visual weight, and interaction patterns consistent on desktop and mobile.
- Preserve all existing functionality, keyboard shortcuts, localization, theming, and custom app-title support.

## Non-Goals

- Changing opportunity data, filters, metrics, or business rules.
- Redesigning the table, Kanban cards, or unrelated application pages.
- Removing sharing, language, theme, account, or logout functionality.
- Introducing new dependencies or a new design system.

## Approved Design

### Brand and navigation

The top-left brand block remains the sole location for the configurable application title and its product eyebrow. The home navigation item is renamed from the application title to “Opportunities” so it describes its destination rather than repeating the brand.

The header keeps the existing page navigation and active-state behavior. On mobile, the same destination label appears in the menu.

### Dashboard heading

The standalone “Nexus CRM” heading and subtitle are removed from the dashboard. The summary metrics become the first dashboard content below the global header, reducing vertical repetition without losing context: the active “Opportunities” navigation item and the workspace heading already identify the page.

Custom app titles continue to appear in the brand block and browser title; they are no longer duplicated as dashboard content.

### Opportunity workspace toolbar

The workspace heading, primary create action, view selector, and overflow action are consolidated into one responsive toolbar above the opportunity content.

Desktop order:

1. “Opportunities (count)” on the left.
2. Table/Kanban segmented control on the right.
3. “More” overflow action.
4. “New Opportunity” as the final, visually primary action.

Mobile behavior:

- The heading occupies its own full-width row when space is constrained.
- The controls wrap predictably without horizontal overflow.
- All interactive controls retain at least a 40px target height.
- The create action remains labeled and prominent.

The segmented control stays visually connected because its buttons are mutually exclusive views. “More” and “New Opportunity” use the same height and corner-radius family, with emphasis determined by function rather than arbitrary size.

### Global utilities

Sharing, theme, language, account identity, and logout are consolidated into a compact account/system menu in the header. The trigger uses the user avatar or initial and exposes an accessible label.

The menu contains:

- Share portfolio, when a share URL exists.
- Theme selection/cycling.
- Language switching.
- The signed-in user identity as non-action context.
- Logout as the final action.

Desktop and mobile use the same menu content so utility placement remains consistent across breakpoints. Settings remains a primary navigation destination for administrators and is not duplicated in this menu.

## Accessibility and Interaction

- Preserve visible focus states and keyboard activation for all controls.
- The account/system menu closes on Escape, outside click, and navigation.
- Menu actions have text labels; icons remain supplementary.
- Active view and active navigation states remain programmatically identifiable.
- Existing localized labels are reused or extended in both German and English.

## Verification

- Add or update component tests for the renamed navigation item and utility menu behavior.
- Run lint, typecheck, unit tests, and static analysis already configured by the project.
- Capture desktop and mobile screenshots of the dashboard.
- Compare the resulting hierarchy against the annotated reference using `visual-verdict`; iterate until the score is at least 90.
- Execute the plan's explicit acceptance matrix: desktop/light/German/default-title/sharing/admin; desktop/dark/English/custom-title/no-sharing/non-admin; mobile/light/English/default-title/sharing/non-admin; and mobile/dark/German/custom-title/no-sharing/admin.
- Across that matrix, verify portal mounting, outside-click dismissal, Escape dismissal with trigger-focus restoration, pathname-change dismissal, dark-mode contrast, localized labels, custom-title uniqueness, conditional sharing, and role-gated Settings navigation.

## Risks and Mitigations

- Moving utilities into a menu adds one click. Their low frequency makes this appropriate; clear text labels preserve discoverability.
- Removing the dashboard title could reduce context on a deep link. The persistent active “Opportunities” navigation state and workspace heading retain two distinct orientation cues.
- A crowded mobile toolbar could wrap awkwardly. The layout explicitly permits a full-width heading row and uses consistent minimum target sizes.
- Reusing the current action-menu primitive may not fit mixed utility controls. Prefer extending the existing accessible pattern only when its behavior fits; otherwise create a narrowly scoped header utility menu without a dependency.

## Scope

Expected implementation is limited to the application header, dashboard toolbar, localization strings, focused component tests, and any small shared styling needed for consistent control sizing.
