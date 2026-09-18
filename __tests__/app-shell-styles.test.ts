import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const globals = fs.readFileSync(
  path.join(process.cwd(), "app", "globals.css"),
  "utf8",
);

function ruleFor(selector: string): string {
  const start = globals.indexOf(`${selector} {`);
  expect(start, `${selector} not found in globals.css`).toBeGreaterThan(-1);
  return globals.slice(start, globals.indexOf("}", start));
}

describe("nexus-shell containment", () => {
  it("clips horizontal overflow instead of hiding it", () => {
    // `overflow-x: hidden` turns the shell into a scroll container, which
    // silently breaks `position: sticky` for the header and the sidebar
    // rendered inside it. `clip` contains overflow without a scrollport.
    const rule = ruleFor(".nexus-shell");

    expect(rule).toContain("overflow-x-clip");
    expect(rule).not.toContain("overflow-x-hidden");
  });
});
