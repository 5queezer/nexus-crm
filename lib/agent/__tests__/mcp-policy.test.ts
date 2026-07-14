import { describe, expect, it } from "vitest";
import { isPublicAddress, validateMcpDestination } from "../mcp-policy";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 as const }];

describe("MCP destination policy", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.1.2",
    "172.31.255.1",
    "192.168.1.2",
    "192.0.0.8",
    "192.0.2.10",
    "198.18.0.1",
    "198.51.100.20",
    "203.0.113.30",
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "100.64.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a00:1",
    "0:0:0:0:0:ffff:7f00:1",
    "2001:db8::1",
  ])("classifies %s as non-public", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "classifies %s as public",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );

  it("accepts an HTTPS destination only after public DNS resolution", async () => {
    const result = await validateMcpDestination("https://mcp.example.com/api", {
      resolve: publicResolver,
    });
    expect(result.toString()).toBe("https://mcp.example.com/api");
  });

  it.each([
    "file:///etc/passwd",
    "ftp://example.com/tools",
    "https://user:pass@example.com/mcp",
    "https://example.com/mcp#fragment",
    "http://example.com/mcp",
  ])("rejects unsafe URL %s", async (url) => {
    await expect(validateMcpDestination(url, { resolve: publicResolver })).rejects.toThrow(
      "Unsafe MCP destination",
    );
  });

  it("rejects a hostname if any resolved address is private", async () => {
    await expect(
      validateMcpDestination("https://rebinding.example/mcp", {
        resolve: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.7", family: 4 },
        ],
      }),
    ).rejects.toThrow("Unsafe MCP destination");
  });

  it("allows localhost only in explicit local development", async () => {
    const result = await validateMcpDestination("http://localhost:3001/mcp", {
      allowLocalDevelopment: true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    expect(result.hostname).toBe("localhost");
  });
});
