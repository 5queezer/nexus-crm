import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type AddressRecord = { address: string; family: number };
export type McpDestinationPolicyOptions = {
  allowLocalDevelopment?: boolean;
  resolve?: (hostname: string) => Promise<AddressRecord[]>;
};

function ipv4Number(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inIpv4Range(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);

  if (isIP(normalized) === 4) {
    const value = ipv4Number(normalized)!;
    const blocked: Array<[string, number]> = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
      ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
      ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4],
    ];
    return !blocked.some(([base, prefix]) => inIpv4Range(value, ipv4Number(base)!, prefix));
  }
  if (isIP(normalized) === 6) {
    if (normalized === "::" || normalized === "::1") return false;
    if (/^(?:fc|fd)/.test(normalized)) return false;
    if (/^fe[89ab]/.test(normalized)) return false;
    if (/^ff/.test(normalized)) return false;
    return true;
  }
  return false;
}

async function defaultResolver(hostname: string): Promise<AddressRecord[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

export async function validateMcpDestination(
  rawUrl: string,
  options: McpDestinationPolicyOptions = {},
): Promise<URL> {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password || url.hash) throw new Error("unsafe URL components");
    const localHost = url.hostname === "localhost" || url.hostname.endsWith(".localhost");
    if (options.allowLocalDevelopment && localHost && url.protocol === "http:") return url;
    if (url.protocol !== "https:") throw new Error("HTTPS required");

    const records = isIP(url.hostname)
      ? [{ address: url.hostname, family: isIP(url.hostname) }]
      : await (options.resolve ?? defaultResolver)(url.hostname);
    if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
      throw new Error("non-public address");
    }
    return url;
  } catch {
    throw new Error("Unsafe MCP destination");
  }
}
