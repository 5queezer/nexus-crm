import { describe, expect, it } from "vitest";
import {
  effectiveMcpScopes,
  isLoopbackRedirectUri,
  isRedirectUriAllowed,
  SENSITIVE_CONSENT_VERSION,
} from "../mcp-oauth";

describe("MCP OAuth redirect validation", () => {
  it("accepts exact registered redirect URIs", () => {
    expect(
      isRedirectUriAllowed(
        ["https://claude.ai/api/mcp/auth_callback"],
        "https://claude.ai/api/mcp/auth_callback"
      )
    ).toBe(true);
  });

  it("accepts loopback redirects with dynamic ports for native PKCE clients", () => {
    expect(
      isRedirectUriAllowed(
        ["http://127.0.0.1:39123/callback"],
        "http://127.0.0.1:47987/callback"
      )
    ).toBe(true);
  });

  it("does not treat arbitrary http redirects as loopback redirects", () => {
    expect(isLoopbackRedirectUri("http://example.com/callback")).toBe(false);
    expect(
      isRedirectUriAllowed(
        ["http://127.0.0.1:39123/callback"],
        "http://example.com/callback"
      )
    ).toBe(false);
  });

  it("does not allow loopback redirects when no loopback redirect was registered", () => {
    expect(
      isRedirectUriAllowed(
        ["https://claude.ai/api/mcp/auth_callback"],
        "http://127.0.0.1:47987/callback"
      )
    ).toBe(false);
  });
});

describe("MCP OAuth sensitive consent versioning", () => {
  it("does not activate a legacy mcp:submissions scope string", () => {
    expect(effectiveMcpScopes(["mcp:tools", "mcp:submissions"], 0)).toEqual(["mcp:tools"]);
  });

  it("preserves mcp:submissions only after versioned consent", () => {
    expect(effectiveMcpScopes(
      ["mcp:tools", "mcp:submissions"],
      SENSITIVE_CONSENT_VERSION,
    )).toEqual(["mcp:tools", "mcp:submissions"]);
  });
});
