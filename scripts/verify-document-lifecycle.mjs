import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { unlink, writeFile } from "node:fs/promises";

const databaseUrl = process.env.TEST_DATABASE_URL;
const authSecret = process.env.TEST_BETTER_AUTH_SECRET;
const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3001";
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
const browserExecutable = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

if (!databaseUrl || !authSecret || !playwrightModule || !browserExecutable) {
  throw new Error("TEST_DATABASE_URL, TEST_BETTER_AUTH_SECRET, PLAYWRIGHT_MODULE, and PLAYWRIGHT_EXECUTABLE_PATH are required");
}

const parsedDatabaseUrl = new URL(databaseUrl);
const parsedBaseUrl = new URL(baseUrl);
const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
if (!localHosts.has(parsedDatabaseUrl.hostname) || !/(test|check|dev)/i.test(parsedDatabaseUrl.pathname)) {
  throw new Error("Refusing to use a non-local or non-test database");
}
if (!localHosts.has(parsedBaseUrl.hostname)) {
  throw new Error("Refusing to exercise a non-local server");
}

process.env.DATABASE_URL = databaseUrl;
const [{ PrismaClient }, { chromium }] = await Promise.all([
  import("@prisma/client"),
  Promise.resolve(createRequire(import.meta.url)(playwrightModule)),
]);
const prisma = new PrismaClient();

const marker = `nexus-document-lifecycle-${Date.now()}`;
const ownerId = `${marker}-owner`;
const attackerId = `${marker}-attacker`;
const ownerToken = `${marker}-owner-token`;
const attackerToken = `${marker}-attacker-token`;
const pdfPath = path.join("/tmp", `${marker}.pdf`);
const uploadDir = process.env.TEST_UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
const createdDocumentNames = new Set();

function sessionCookie(token) {
  const signature = createHmac("sha256", authSecret).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

const ownerCookie = sessionCookie(ownerToken);
const attackerCookie = sessionCookie(attackerToken);

async function api(pathname, init = {}, cookie = ownerCookie) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", `better-auth.session_token=${cookie}; locale=en`);
  return fetch(new URL(pathname, baseUrl), { ...init, headers });
}

async function expectStatus(response, expected, label) {
  const actual = typeof response.status === "function" ? response.status() : response.status;
  if (actual === expected) return response;
  const body = await response.text().catch(() => "");
  throw new Error(`${label}: expected ${expected}, received ${actual}: ${body.slice(0, 300)}`);
}

async function cleanup() {
  if (documentId) {
    await api(`/api/documents/${documentId}`, { method: "DELETE" }).catch(() => {});
  }
  const documents = await prisma.document.findMany({
    where: { userId: { in: [ownerId, attackerId] } },
    select: { filename: true },
  }).catch(() => []);
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, attackerId] } } }).catch(() => {});
  for (const document of documents) createdDocumentNames.add(document.filename);
  for (const filename of createdDocumentNames) {
    await unlink(path.join(uploadDir, filename)).catch(() => {});
  }
  await unlink(pdfPath).catch(() => {});
}

let browser;
let documentId;
const evidence = {};

try {
  await writeFile(pdfPath, Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"));
  await prisma.user.createMany({ data: [
    { id: ownerId, email: `${ownerId}@example.test`, name: "Document Lifecycle Owner", emailVerified: true, isAdmin: false },
    { id: attackerId, email: `${attackerId}@example.test`, name: "Document Lifecycle Attacker", emailVerified: true, isAdmin: false },
  ] });
  await prisma.session.createMany({ data: [
    { id: `${marker}-owner-session`, userId: ownerId, token: ownerToken, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    { id: `${marker}-attacker-session`, userId: attackerId, token: attackerToken, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  ] });
  const [firstApplication, secondApplication] = await Promise.all([
    prisma.application.create({ data: { userId: ownerId, company: `${marker} Northstar`, role: "Engineer", status: "inbound" } }),
    prisma.application.create({ data: { userId: ownerId, company: `${marker} Aster`, role: "Platform Engineer", status: "inbound" } }),
  ]);

  browser = await chromium.launch({ executablePath: browserExecutable, headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  await context.addCookies([
    { name: "better-auth.session_token", value: ownerCookie, domain: parsedBaseUrl.hostname, path: "/" },
    { name: "locale", value: "en", domain: parsedBaseUrl.hostname, path: "/" },
  ]);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(new URL("/documents", baseUrl).href, { waitUntil: "networkidle" });

  const uploadResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/documents") && response.request().method() === "POST");
  await page.getByLabel("Upload documents").setInputFiles(pdfPath);
  const uploadResponse = await uploadResponsePromise;
  await expectStatus(uploadResponse, 201, "browser upload");
  const uploaded = await uploadResponse.json();
  documentId = String(uploaded.id);
  createdDocumentNames.add(uploaded.filename);
  assert.equal(uploaded.version, 1);
  assert.equal(uploaded.state, "current");
  evidence.upload = uploadResponse.status();

  const metadataResponse = await api(`/api/documents/${documentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentType: "resume", state: "current", version: 3 }),
  });
  await expectStatus(metadataResponse, 200, "set version metadata");
  assert.equal((await metadataResponse.json()).version, 3);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(`${marker}\\.pdf`) }).click();

  for (const application of [firstApplication, secondApplication]) {
    await page.getByRole("combobox", { name: "Link opportunity" }).selectOption(String(application.id));
    const linkResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith(`/api/documents/${documentId}`) && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Add opportunity link" }).click();
    await expectStatus(await linkResponsePromise, 200, "browser link update");
    await page.getByRole("link", { name: `${application.company} — ${application.role}` }).waitFor();
  }

  let listed = await api("/api/documents");
  await expectStatus(listed, 200, "owner document list");
  let stored = (await listed.json()).find((document) => String(document.id) === documentId);
  assert.equal(stored.version, 3);
  assert.deepEqual(stored.applications.map((application) => String(application.id)).sort(), [String(firstApplication.id), String(secondApplication.id)].sort());
  evidence.linksPreserved = stored.applications.length;
  evidence.versionAfterLinks = stored.version;

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Filename").fill(`${marker}-renamed.pdf`);
  const renameResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/api/documents/${documentId}`) && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save" }).click();
  await expectStatus(await renameResponsePromise, 200, "browser rename");
  await page.getByRole("heading", { name: `${marker}-renamed.pdf` }).waitFor();

  listed = await api("/api/documents");
  await expectStatus(listed, 200, "owner document list after rename");
  stored = (await listed.json()).find((document) => String(document.id) === documentId);
  assert.equal(stored.originalName, `${marker}-renamed.pdf`);
  assert.equal(stored.version, 3);
  assert.equal(stored.applications.length, 2);
  evidence.renamePreservedVersion = stored.version;

  const ownerFileResponse = await api(`/api/documents/${documentId}/file`);
  await expectStatus(ownerFileResponse, 200, "owner file read");
  assert.match(ownerFileResponse.headers.get("content-type") ?? "", /^application\/pdf/);
  const ownerFileBytes = Buffer.from(await ownerFileResponse.arrayBuffer());
  assert.equal(ownerFileBytes.subarray(0, 5).toString("ascii"), "%PDF-");
  evidence.ownerFileRead = ownerFileResponse.status;
  evidence.ownerFileBytes = ownerFileBytes.length;

  evidence.unauthenticatedRead = (await api(`/api/documents/${documentId}/file`, {}, null)).status;
  assert.equal(evidence.unauthenticatedRead, 401);
  evidence.crossUserRead = (await api(`/api/documents/${documentId}/file`, {}, attackerCookie)).status;
  assert.equal(evidence.crossUserRead, 404);
  evidence.crossUserRename = (await api(`/api/documents/${documentId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ originalName: "stolen.pdf" }),
  }, attackerCookie)).status;
  assert.equal(evidence.crossUserRename, 404);
  evidence.crossUserShare = (await api("/api/share-links", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetType: "document", targetId: documentId }),
  }, attackerCookie)).status;
  assert.equal(evidence.crossUserShare, 404);

  const shareResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/share-links") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create share link" }).click();
  const shareResponse = await shareResponsePromise;
  await expectStatus(shareResponse, 201, "browser share create");
  const shareLink = await shareResponse.json();
  await page.getByText("Shared by link").waitFor();
  const publicResponse = await api(`/s/${shareLink.code}`, {}, null);
  await expectStatus(publicResponse, 200, "public share read");
  assert.match(publicResponse.headers.get("content-type") ?? "", /^application\/pdf/);
  const publicFileBytes = Buffer.from(await publicResponse.arrayBuffer());
  assert.deepEqual(publicFileBytes, ownerFileBytes);
  evidence.publicReadBeforeRevoke = publicResponse.status;

  const revokeResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/share-links") && response.request().method() === "DELETE");
  await page.getByRole("button", { name: "Revoke share link" }).click();
  await expectStatus(await revokeResponsePromise, 204, "browser share revoke");
  await page.getByText("Private · Only you").waitFor();
  evidence.publicReadAfterRevoke = (await api(`/s/${shareLink.code}`, {}, null)).status;
  assert.equal(evidence.publicReadAfterRevoke, 404);

  const deleteResponse = await api(`/api/documents/${documentId}`, { method: "DELETE" });
  await expectStatus(deleteResponse, 204, "owner document cleanup");
  evidence.ownerReadAfterDelete = (await api(`/api/documents/${documentId}/file`)).status;
  assert.equal(evidence.ownerReadAfterDelete, 404);
  evidence.pageErrors = pageErrors;
  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  await cleanup();
  await prisma.$disconnect();
}
