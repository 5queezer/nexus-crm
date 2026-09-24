import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApplicationId } from "../application-id";

describe("ApplicationId", () => {
  it("renders numeric ids as #id", () => {
    expect(renderToStaticMarkup(<ApplicationId id="170" />)).toContain("#170");
  });

  it("hides opaque document ids", () => {
    expect(renderToStaticMarkup(<ApplicationId id="demo-app" />)).toBe("");
  });
});
