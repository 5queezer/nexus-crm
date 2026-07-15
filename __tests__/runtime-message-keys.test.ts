import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";

const INTEGRATED_DYNAMIC_KEYS = [
  "command_palette.focus_view",
  "actions.open_job",
  "shortcuts.focus_view",
  "modal.close",
  "modal.secondary_details",
  "kanban.open",
  "kanban.change_status",
  "actions.select_opportunity",
  "nav.menu",
  "dashboard.loading",
] as const;

function flattenMessages(
  value: Record<string, unknown>,
  prefix = "",
): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" && !Array.isArray(child)
      ? flattenMessages(child as Record<string, unknown>, fullKey)
      : [fullKey];
  });
}

function hasMessage(messages: Record<string, unknown>, key: string): boolean {
  let current: unknown = messages;
  for (const segment of key.split(".")) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return false;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string";
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")
      ? [entryPath]
      : [];
  });
}

function literalRuntimeKeys(): string[] {
  const roots = ["app", "components", "hooks", "lib"];
  return roots.flatMap((root) =>
    sourceFiles(path.join(process.cwd(), root)).flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      const translators = new Map<string, string>();
      const assignmentPattern =
        /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*["']([^"']+)["']/g;
      for (const match of source.matchAll(assignmentPattern)) {
        translators.set(match[1], match[2]);
      }
      const literalCallPattern =
        /(?<![\w.])(\w+)\(\s*["']([^"']+)["']/g;
      return Array.from(source.matchAll(literalCallPattern)).flatMap((match) => {
        const namespace = translators.get(match[1]);
        return namespace ? [`${namespace}.${match[2]}`] : [];
      });
    }),
  );
}

describe("runtime message catalogs", () => {
  it("keeps English and German keys in exact parity", () => {
    expect(flattenMessages(en).sort()).toEqual(flattenMessages(de).sort());
  });

  it("contains every literal translation key referenced by runtime UI", () => {
    const runtimeKeys = Array.from(new Set(literalRuntimeKeys())).sort();
    const missing = runtimeKeys.filter(
      (key) => !hasMessage(en, key) || !hasMessage(de, key),
    );
    expect(missing).toEqual([]);
  });

  it("covers integrated dynamic and reviewed runtime keys with real catalogs", () => {
    for (const key of INTEGRATED_DYNAMIC_KEYS) {
      expect(hasMessage(en, key), `missing EN key: ${key}`).toBe(true);
      expect(hasMessage(de, key), `missing DE key: ${key}`).toBe(true);
    }
  });
});
