import { describe, it, expect } from "vitest";
import config from "@/next.config";

type Rewrite = { source: string; destination: string };

/**
 * Regression guard for the `/mcp` connector URL. Discovery metadata is served on
 * every path, so OAuth succeeds even when a client is registered against `/mcp`;
 * without an alias the follow-up JSON-RPC POST hit an HTML 404 ("authorized, but
 * no MCP server was found at the given URL"). The canonical MCP route lives at
 * `/api/mcp`, so `/mcp` must rewrite there.
 */
describe("MCP connector URL alias", () => {
  it("rewrites /mcp to the canonical /api/mcp route", async () => {
    const rewritesFn = (config as { rewrites?: () => Promise<Rewrite[] | { beforeFiles?: Rewrite[] }> }).rewrites;
    expect(typeof rewritesFn).toBe("function");

    const result = await rewritesFn!();
    const rules: Rewrite[] = Array.isArray(result) ? result : (result.beforeFiles ?? []);

    expect(rules).toContainEqual({ source: "/mcp", destination: "/api/mcp" });
    expect(rules).toContainEqual({ source: "/mcp/:path*", destination: "/api/mcp/:path*" });
  });
});
