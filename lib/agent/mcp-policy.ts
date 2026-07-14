import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export type AddressRecord = { address: string; family: number };
export type McpDestinationPolicyOptions = {
  allowLocalDevelopment?: boolean;
  resolve?: (hostname: string) => Promise<AddressRecord[]>;
};

function addressRange(address: string): string | null {
  try {
    const parsed = ipaddr.parse(address.toLowerCase().split("%")[0]);
    if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
      return parsed.toIPv4Address().range();
    }
    return parsed.range();
  } catch {
    return null;
  }
}

export function isPublicAddress(address: string): boolean {
  return addressRange(address) === "unicast";
}

function isLoopbackAddress(address: string): boolean {
  return addressRange(address) === "loopback";
}

async function defaultResolver(hostname: string): Promise<AddressRecord[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

export type ValidatedMcpDestination = {
  url: URL;
  address: string;
  family: number;
};

export async function resolveMcpDestination(
  rawUrl: string,
  options: McpDestinationPolicyOptions = {},
): Promise<ValidatedMcpDestination> {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password || url.hash) throw new Error("unsafe URL components");
    const localHost = url.hostname === "localhost" || url.hostname.endsWith(".localhost");
    if (options.allowLocalDevelopment && localHost && url.protocol === "http:") {
      const records = await (options.resolve ?? defaultResolver)(url.hostname);
      if (!records.length || records.some((record) => !isLoopbackAddress(record.address))) {
        throw new Error("non-loopback localhost");
      }
      const selected = records[0];
      return { url, address: selected.address, family: selected.family };
    }
    if (url.protocol !== "https:") throw new Error("HTTPS required");

    const records = isIP(url.hostname)
      ? [{ address: url.hostname, family: isIP(url.hostname) }]
      : await (options.resolve ?? defaultResolver)(url.hostname);
    if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
      throw new Error("non-public address");
    }
    const selected = records[0];
    return { url, address: selected.address, family: selected.family };
  } catch {
    throw new Error("Unsafe MCP destination");
  }
}

export async function validateMcpDestination(
  rawUrl: string,
  options: McpDestinationPolicyOptions = {},
): Promise<URL> {
  return (await resolveMcpDestination(rawUrl, options)).url;
}
