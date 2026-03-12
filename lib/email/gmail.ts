import { decryptToken } from "./encryption";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GmailMessage {
  id: string;
  threadId: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessageDetail {
  id: string;
  historyId: string;
  payload: {
    headers: GmailHeader[];
    body?: { data?: string };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string };
      parts?: Array<{ mimeType: string; body?: { data?: string } }>;
    }>;
  };
  snippet: string;
  internalDate: string;
}

export interface ParsedEmail {
  messageId: string;
  subject: string;
  sender: string;
  receivedAt: Date;
  bodySnippet: string;
}

// Cache access tokens to avoid redundant token refresh calls.
// Key: encrypted refresh token, Value: { token, expiresAt }
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Exchange a refresh token for a fresh access token (cached).
 * Tokens are cached with a 5-minute safety margin before expiry.
 */
async function getAccessToken(encryptedRefreshToken: string): Promise<string> {
  const cached = tokenCache.get(encryptedRefreshToken);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const refreshToken = decryptToken(encryptedRefreshToken);
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to refresh access token: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in?: number };
  const expiresIn = data.expires_in ?? 3600; // Default 1 hour
  // Cache with 5-minute safety margin
  tokenCache.set(encryptedRefreshToken, {
    token: data.access_token,
    expiresAt: Date.now() + (expiresIn - 300) * 1000,
  });

  return data.access_token;
}

/**
 * Fetch new message IDs since a given historyId, or list recent messages.
 */
export async function fetchNewMessages(
  encryptedRefreshToken: string,
  lastHistoryId: string | null,
  maxResults = 50,
  daysBack = 7
): Promise<{ messages: GmailMessage[]; latestHistoryId: string | null }> {
  const accessToken = await getAccessToken(encryptedRefreshToken);
  const headers = { Authorization: `Bearer ${accessToken}` };

  if (lastHistoryId) {
    // Incremental: use history API
    const url = `${GMAIL_API}/history?startHistoryId=${lastHistoryId}&historyTypes=messageAdded&maxResults=${maxResults}`;
    const resp = await fetch(url, { headers });

    if (resp.status === 404) {
      // historyId expired, fall back to list
      return fetchNewMessages(encryptedRefreshToken, null, maxResults, daysBack);
    }

    if (!resp.ok) {
      throw new Error(`Gmail history API error: ${resp.status}`);
    }

    const data = (await resp.json()) as {
      history?: Array<{ messagesAdded?: Array<{ message: GmailMessage }> }>;
      historyId: string;
    };

    const messages: GmailMessage[] = [];
    for (const h of data.history ?? []) {
      for (const m of h.messagesAdded ?? []) {
        messages.push(m.message);
      }
    }

    return { messages, latestHistoryId: data.historyId };
  }

  // Full list: get recent messages
  const after = Math.floor(
    (Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000
  );
  const url = `${GMAIL_API}/messages?q=after:${after}&maxResults=${maxResults}`;
  const resp = await fetch(url, { headers });

  if (!resp.ok) {
    throw new Error(`Gmail list API error: ${resp.status}`);
  }

  const data = (await resp.json()) as {
    messages?: GmailMessage[];
  };

  // Get current historyId from profile
  const profileResp = await fetch(`${GMAIL_API}/profile`, { headers });
  const profile = (await profileResp.json()) as { historyId: string };

  return {
    messages: data.messages ?? [],
    latestHistoryId: profile.historyId,
  };
}

/**
 * Fetch full message details and parse into a simplified structure.
 */
export async function getMessageDetail(
  encryptedRefreshToken: string,
  messageId: string
): Promise<ParsedEmail> {
  const accessToken = await getAccessToken(encryptedRefreshToken);
  const url = `${GMAIL_API}/messages/${messageId}?format=full`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    throw new Error(`Gmail message API error: ${resp.status}`);
  }

  const msg = (await resp.json()) as GmailMessageDetail;

  const getHeader = (name: string): string => {
    const h = msg.payload.headers.find(
      (h) => h.name.toLowerCase() === name.toLowerCase()
    );
    return h?.value ?? "";
  };

  // Extract plaintext body (first 500 chars)
  let bodySnippet = msg.snippet || "";
  const textPart = findTextPart(msg.payload);
  if (textPart) {
    const decoded = Buffer.from(textPart, "base64url").toString("utf8");
    bodySnippet = decoded.slice(0, 500);
  }

  return {
    messageId: msg.id,
    subject: getHeader("Subject"),
    sender: getHeader("From"),
    receivedAt: new Date(parseInt(msg.internalDate, 10)),
    bodySnippet,
  };
}

function findTextPart(
  payload: GmailMessageDetail["payload"]
): string | null {
  if (payload.body?.data && !payload.parts) {
    return payload.body.data;
  }
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return part.body.data;
    }
    // Recurse into multipart
    if (part.parts) {
      for (const sub of part.parts) {
        if (sub.mimeType === "text/plain" && sub.body?.data) {
          return sub.body.data;
        }
      }
    }
  }
  return null;
}
