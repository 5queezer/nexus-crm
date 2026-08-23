import { getFirestore, Timestamp, FieldValue, FieldPath } from "firebase-admin/firestore";
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { prisma } from "@/lib/prisma";
import { normalizeStatus } from "@/types";
import { resolveAppliedAtForCreate } from "@/lib/applications/defaults";
import {
  submissionInputRequestHash,
  submissionReplayRequestHashes,
  submissionRequestHash,
  validateSubmissionConflicts,
  validateSubmissionDocumentIds,
  validateSubmissionPolicy,
} from "@/lib/applications/submission";
import {
  deriveEventProjection,
  encodeEventCursor,
  validateApplicationSummary,
} from "@/lib/applications/events";
import type { DatabaseAdapter } from "./adapter";
import type {
  ApplicationRecord,
  ContactRecord,
  DocumentRecord,
  UserRecord,
  AuditLogRecord,
  ApiTokenRecord,
  ApiTokenInfo,
  ShareLinkRecord,
  CreateApplicationInput,
  UpdateApplicationInput,
  CreateContactInput,
  UpdateContactInput,
  CreateDocumentInput,
  CreateShareLinkInput,
  ListApplicationsFilter,
  PaginationParams,
  PaginatedResult,
  BatchUpsertItem,
  BatchUpsertResult,
  BatchDeleteResult,
  CvProfileRecord,
  UpsertCvProfileInput,
  CvPatchRecord,
  UpsertCvPatchInput,
  ApplicationSubmissionRecord,
  ApplicationEventRecord,
  RecordSubmissionInput,
  RecordSubmissionResult,
  CreateApplicationEventInput,
  RecordApplicationEventInput,
  RecordApplicationEventResult,
  ListApplicationEventsFilter,
  ApplicationEventPage,
  ListDocumentsFilter,
  UpdateDocumentMetadataInput,
  DocumentMutationOptions,
  DemoReadOptions,
  EnsureDemoWorkspaceResult,
  DeleteDemoWorkspaceResult,
  CareerOpsThreadRecord,
  CareerOpsRunRecord,
  CareerOpsRunStatus,
  CreateCareerOpsThreadInput,
  CreateCareerOpsRunInput,
  CareerOpsApprovalGateClaim,
  CareerOpsApprovalState,
  CareerOpsRunClaim,
  CareerOpsThreadDeletion,
} from "./types";
import {
  CAREER_OPS_ACTIVE_RUN_STATUSES,
  CAREER_OPS_TERMINAL_RUN_STATUSES,
} from "./types";
import type { DemoFixtures } from "@/lib/demo-workspace/fixtures";

// ── Firestore init ──────────────────────────────────────────────────────────

function getDb() {
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault() });
  }
  return getFirestore();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toDate(v: Timestamp | null | undefined): Date | null {
  return v ? v.toDate() : null;
}

function toTimestamp(v: Date | null | undefined): Timestamp | null {
  return v ? Timestamp.fromDate(v) : null;
}

function mapApp(id: string, data: FirebaseFirestore.DocumentData): ApplicationRecord {
  return {
    id,
    userId: data.userId,
    company: data.company,
    role: data.role,
    status: normalizeStatus(data.status),
    appliedAt: toDate(data.appliedAt),
    lastContact: toDate(data.lastContact),
    followUpAt: toDate(data.followUpAt),
    notes: data.notes ?? null,
    jobDescription: data.jobDescription ?? null,
    source: data.source ?? null,
    remote: data.remote ?? false,
    salaryMin: data.salaryMin ?? null,
    salaryMax: data.salaryMax ?? null,
    rating: data.rating ?? null,
    jobUrl: data.jobUrl ?? null,
    canonicalJobUrl: data.canonicalJobUrl ?? null,
    resumeId: data.resumeId ?? null,
    companySize: data.companySize ?? null,
    salaryBandMentioned: data.salaryBandMentioned ?? false,
    triageQuality: data.triageQuality ?? null,
    triageReason: data.triageReason ?? null,
    incomingSource: data.incomingSource ?? null,
    autoRejected: data.autoRejected ?? false,
    autoRejectReason: data.autoRejectReason ?? null,
    archivedAt: toDate(data.archivedAt) ?? null,
    workMode: data.workMode ?? null,
    eligibleCountries: Array.isArray(data.eligibleCountries) ? data.eligibleCountries : [],
    primaryLocations: Array.isArray(data.primaryLocations) ? data.primaryLocations : [],
    officeDaysMin: data.officeDaysMin ?? null,
    travelPercent: data.travelPercent ?? null,
    visaSponsorship: data.visaSponsorship ?? null,
    rightToWorkRequired: data.rightToWorkRequired ?? null,
    timezoneOverlap: data.timezoneOverlap ?? null,
    salaryCurrency: data.salaryCurrency ?? null,
    salaryPeriod: data.salaryPeriod ?? null,
    salaryType: data.salaryType ?? null,
    atsName: data.atsName ?? null,
    requisitionId: data.requisitionId ?? null,
    jobCapturedAt: toDate(data.jobCapturedAt),
    jobVerifiedAt: toDate(data.jobVerifiedAt),
    jobPostedAt: toDate(data.jobPostedAt),
    jobClosedAt: toDate(data.jobClosedAt),
    jobContentHash: data.jobContentHash ?? null,
    jobLiveness: data.jobLiveness ?? null,
    jobSummary: data.jobSummary ?? null,
    currentStage: data.currentStage ?? null,
    isDemo: data.isDemo === true,
    demoWorkspaceId: data.demoWorkspaceId ?? null,
    demoKey: data.demoKey ?? null,
    createdAt: toDate(data.createdAt) ?? new Date(),
    updatedAt: toDate(data.updatedAt) ?? new Date(),
    contacts: data._contacts,
  };
}

function mapContact(id: string, data: FirebaseFirestore.DocumentData): ContactRecord {
  return {
    id,
    name: data.name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    role: data.role ?? null,
    linkedIn: data.linkedIn ?? null,
    applicationId: data.applicationId,
    createdAt: toDate(data.createdAt) ?? new Date(),
  };
}

function mapDoc(id: string, data: FirebaseFirestore.DocumentData): DocumentRecord {
  return {
    id,
    userId: data.userId,
    filename: data.filename,
    originalName: data.originalName,
    size: data.size,
    mimeType: data.mimeType,
    documentType: data.documentType ?? "other",
    state: data.state ?? "current",
    version: data.version ?? 1,
    contentHash: data.contentHash ?? null,
    source: data.source ?? null,
    generatedAt: toDate(data.generatedAt),
    submittedAt: toDate(data.submittedAt),
    submissionId: data.submissionId ?? null,
    uploadedAt: toDate(data.uploadedAt) ?? new Date(),
    demoProvenance: data.demoProvenance === true,
    applicationIds: Array.isArray(data.applicationIds) ? data.applicationIds : [],
    applications: data._applications,
  };
}

function mapSubmission(
  id: string,
  data: FirebaseFirestore.DocumentData,
  includeAnswers = true,
): ApplicationSubmissionRecord {
  return {
    id,
    userId: data.userId,
    applicationId: data.applicationId,
    idempotencyKey: data.idempotencyKey,
    requestHash: data.requestHash,
    submittedAt: toDate(data.submittedAt) ?? new Date(),
    applicationUrl: data.applicationUrl ?? null,
    atsName: data.atsName ?? null,
    requisitionId: data.requisitionId ?? null,
    language: data.language ?? null,
    answers: includeAnswers && Array.isArray(data.answers) ? data.answers : [],
    policy: data.policy && typeof data.policy === "object" ? data.policy : {},
    candidateSalaryMin: data.candidateSalaryMin ?? null,
    candidateSalaryMax: data.candidateSalaryMax ?? null,
    candidateSalaryCurrency: data.candidateSalaryCurrency ?? null,
    candidateSalaryPeriod: data.candidateSalaryPeriod ?? null,
    candidateSalaryType: data.candidateSalaryType ?? null,
    candidateSalaryFlexible: data.candidateSalaryFlexible ?? false,
    documentIds: Array.isArray(data.documentIds) ? data.documentIds : [],
    createdAt: toDate(data.createdAt) ?? new Date(),
    documents: data._documents,
  };
}

function publicEventMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = { ...(value as Record<string, unknown>) };
  delete metadata.requestHash;
  return metadata;
}

function mapEvent(id: string, data: FirebaseFirestore.DocumentData): ApplicationEventRecord {
  return {
    id,
    userId: data.userId,
    applicationId: data.applicationId,
    type: data.type,
    idempotencyKey: data.idempotencyKey ?? null,
    occurredAt: toDate(data.occurredAt) ?? new Date(),
    source: data.source ?? null,
    actor: data.actor ?? null,
    contactId: data.contactId ?? null,
    outcome: data.outcome ?? null,
    metadata: publicEventMetadata(data.metadata),
    createdAt: toDate(data.createdAt) ?? new Date(),
    isDemo: data.isDemo === true,
    demoWorkspaceId: data.demoWorkspaceId ?? null,
    demoKey: data.demoKey ?? null,
    application: data._application,
  };
}

const STRUCTURED_METADATA_FIELDS = [
  "canonicalJobUrl", "workMode", "eligibleCountries", "primaryLocations",
  "officeDaysMin", "travelPercent", "visaSponsorship", "rightToWorkRequired",
  "timezoneOverlap", "salaryCurrency", "salaryPeriod", "salaryType", "atsName",
  "requisitionId", "jobContentHash", "jobLiveness", "jobSummary", "currentStage",
] as const;

const STRUCTURED_DATE_FIELDS = [
  "jobCapturedAt", "jobVerifiedAt", "jobPostedAt", "jobClosedAt",
] as const;

function structuredMetadataForFirestore(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of STRUCTURED_METADATA_FIELDS) {
    if (data[field] !== undefined) result[field] = data[field];
  }
  for (const field of STRUCTURED_DATE_FIELDS) {
    if (data[field] !== undefined) {
      result[field] = toTimestamp(data[field] as Date | null | undefined);
    }
  }
  return result;
}

function isDemoVisible(data: FirebaseFirestore.DocumentData, options?: DemoReadOptions): boolean {
  const isDemo = data.isDemo === true;
  if (options?.demoVisibility === "exclude") return !isDemo;
  if (options?.demoVisibility === "only") return isDemo;
  return true;
}

function firestoreEventDemoData(
  application: FirebaseFirestore.DocumentData,
  stableKey: string,
): { isDemo: boolean; demoWorkspaceId: string | null; demoKey: string | null } {
  const complete = application.isDemo === true
    && typeof application.demoWorkspaceId === "string"
    && typeof application.demoKey === "string";
  const empty = application.isDemo !== true
    && application.demoWorkspaceId == null
    && application.demoKey == null;
  if (!complete && !empty) throw new Error("demo_marker_conflict");
  return complete
    ? {
        isDemo: true,
        demoWorkspaceId: application.demoWorkspaceId,
        demoKey: `${application.demoKey}:event:${stableKey}`,
      }
    : { isDemo: false, demoWorkspaceId: null, demoKey: null };
}

function assertFirestoreEventMatchesParent(
  event: FirebaseFirestore.DocumentData,
  application: FirebaseFirestore.DocumentData,
): void {
  const expected = firestoreEventDemoData(application, "replay");
  if (
    (event.isDemo === true) !== expected.isDemo
    || (event.demoWorkspaceId ?? null) !== expected.demoWorkspaceId
    || (expected.isDemo && (typeof event.demoKey !== "string" || event.demoKey.length === 0))
    || (!expected.isDemo && event.demoKey != null)
  ) throw new Error("demo_marker_conflict");
}

function isFirestoreEventVisibleWithParent(
  event: FirebaseFirestore.DocumentData,
  application: FirebaseFirestore.DocumentData | undefined,
  userId: string,
  options?: DemoReadOptions,
): boolean {
  if (!application || application.userId !== userId || !isDemoVisible(application, options)) return false;
  try {
    assertFirestoreEventMatchesParent(event, application);
    return isDemoVisible(event, options);
  } catch {
    return false;
  }
}

// ── Implementation ──────────────────────────────────────────────────────────

export class FirestoreAdapter implements DatabaseAdapter {
  private get db() { return getDb(); }
  private get apps() { return this.db.collection("applications"); }
  private get contacts() { return this.db.collection("contacts"); }
  private get docs() { return this.db.collection("documents"); }
  private get submissions() { return this.db.collection("applicationSubmissions"); }
  private get events() { return this.db.collection("applicationEvents"); }
  private get demoWorkspaces() { return this.db.collection("demoWorkspaces"); }
  private get ownerLifecycles() { return this.db.collection("ownerApplicationLifecycles"); }
  private get canonicalUrls() { return this.db.collection("applicationCanonicalUrls"); }
  private get careerOpsThreads() { return this.db.collection("careerOpsThreads"); }
  private get careerOpsRuns() { return this.db.collection("careerOpsRuns"); }

  /**
   * Deletions whose run documents have not all been removed yet.
   *
   * Firestore has no cascade, and a conversation's runs cannot be deleted in
   * the same transaction as their parent — a long one exceeds the transaction's
   * write cap. So the children are removed afterwards, and afterwards can fail:
   * a network error, a request that runs out of time, an instance that goes
   * away mid-batch. Previously that possibility was met with a `console.warn`,
   * which is a record no code can act on, and the documents stayed forever.
   *
   * A tombstone written in the same transaction that removes the parent turns
   * that into work something can finish: it names the conversation whose
   * children are still pending and is deleted only once they are all gone. The
   * relational backend needs none of this — the foreign key cascades.
   */
  private get careerOpsThreadDeletions() {
    return this.db.collection("careerOpsThreadDeletions");
  }

  private canonicalUrlRef(userId: string, canonicalJobUrl: string) {
    return this.canonicalUrls.doc(submissionRequestHash({ userId, canonicalJobUrl }));
  }

  private ownerLifecycleRef(userId: string) {
    return this.ownerLifecycles.doc(submissionRequestHash({ kind: "application-owner", userId }));
  }

  async ensureDemoWorkspace(
    userId: string,
    fixtures: DemoFixtures,
  ): Promise<EnsureDemoWorkspaceResult> {
    const workspaceId = submissionRequestHash({ kind: "demo-workspace", userId });
    const workspaceRef = this.demoWorkspaces.doc(workspaceId);
    const lifecycleRef = this.ownerLifecycleRef(userId);
    let replayed = false;
    await this.db.runTransaction(async (transaction) => {
      const [existing, lifecycle] = await Promise.all([
        transaction.get(workspaceRef),
        transaction.get(lifecycleRef),
      ]);
      if (lifecycle.exists && lifecycle.data()!.userId !== userId) throw new Error("demo_marker_conflict");
      if (existing.exists) {
        const data = existing.data()!;
        if (data.userId !== userId) throw new Error("not_found");
        if (data.seedVersion !== fixtures.seedVersion) throw new Error("demo_version_conflict");
        if (data.state !== "ready") throw new Error("demo_workspace_unavailable");
        const [applications, events] = await Promise.all([
          transaction.get(this.apps.where("demoWorkspaceId", "==", workspaceId)),
          transaction.get(this.events.where("demoWorkspaceId", "==", workspaceId)),
        ]);
        const applicationKeys = applications.docs.map((document) => {
          const row = document.data();
          if (row.userId !== userId || row.isDemo !== true || row.demoWorkspaceId !== workspaceId) {
            throw new Error("demo_marker_conflict");
          }
          return row.demoKey;
        }).sort();
        const eventKeys = events.docs.map((document) => {
          const row = document.data();
          if (row.userId !== userId || row.isDemo !== true || row.demoWorkspaceId !== workspaceId) {
            throw new Error("demo_marker_conflict");
          }
          return row.demoKey;
        }).sort();
        if (
          JSON.stringify(applicationKeys) !== JSON.stringify(fixtures.applications.map((fixture) => fixture.demoKey).sort())
          || !fixtures.events.every((fixture) => eventKeys.includes(fixture.demoKey))
        ) throw new Error("demo_workspace_incomplete");
        transaction.set(lifecycleRef, { userId, mode: "demo", workspaceId, updatedAt: Timestamp.now() });
        replayed = true;
        return;
      }
      const realApplications = await transaction.get(
        this.apps.where("userId", "==", userId).where("isDemo", "==", false),
      );
      const legacyApplications = await transaction.get(this.apps.where("userId", "==", userId));
      if (
        !realApplications.empty ||
        legacyApplications.docs.some((document) => document.data().isDemo !== true)
      ) {
        throw new Error("real_applications_exist");
      }

      const createdAt = toTimestamp(fixtures.createdAt);
      transaction.create(workspaceRef, {
        userId,
        seedVersion: fixtures.seedVersion,
        state: "ready",
        createdAt,
        updatedAt: createdAt,
      });
      transaction.set(lifecycleRef, { userId, mode: "demo", workspaceId, updatedAt: createdAt });
      const appIds = new Map<string, string>();
      for (const fixture of fixtures.applications) {
        const id = submissionRequestHash({ workspaceId, demoKey: fixture.demoKey });
        appIds.set(fixture.demoKey, id);
        transaction.create(this.apps.doc(id), {
          userId,
          company: fixture.company,
          role: fixture.role,
          status: fixture.status,
          appliedAt: toTimestamp(fixture.appliedAt),
          lastContact: toTimestamp(fixture.lastContact),
          followUpAt: toTimestamp(fixture.followUpAt),
          notes: fixture.notes,
          jobDescription: null,
          source: fixture.source,
          remote: fixture.remote,
          salaryMin: fixture.salaryMin,
          salaryMax: fixture.salaryMax,
          rating: fixture.rating,
          jobUrl: null,
          isDemo: true,
          demoWorkspaceId: workspaceId,
          demoKey: fixture.demoKey,
          createdAt,
          updatedAt: createdAt,
        });
      }
      for (const fixture of fixtures.events) {
        const applicationId = appIds.get(fixture.applicationDemoKey);
        if (!applicationId) throw new Error("demo_fixture_invalid");
        const id = submissionRequestHash({ workspaceId, demoEventKey: fixture.demoKey });
        transaction.create(this.events.doc(id), {
          userId,
          applicationId,
          type: fixture.type,
          idempotencyKey: null,
          occurredAt: toTimestamp(fixture.occurredAt),
          source: fixture.source,
          actor: fixture.actor,
          metadata: fixture.metadata,
          isDemo: true,
          demoWorkspaceId: workspaceId,
          demoKey: fixture.demoKey,
          createdAt,
        });
      }
    });

    const workspace = await workspaceRef.get();
    if (!workspace.exists) throw new Error("demo_workspace_incomplete");
    const data = workspace.data()!;
    const applications = await this.listApplications(userId, { demoVisibility: "only" });
    return {
      workspace: {
        id: workspaceId,
        userId,
        seedVersion: data.seedVersion,
        state: data.state,
        createdAt: toDate(data.createdAt) ?? fixtures.createdAt,
        updatedAt: toDate(data.updatedAt) ?? fixtures.createdAt,
      },
      applications,
      replayed,
    };
  }

  async deleteDemoWorkspace(userId: string): Promise<DeleteDemoWorkspaceResult> {
    const workspaceId = submissionRequestHash({ kind: "demo-workspace", userId });
    const workspaceRef = this.demoWorkspaces.doc(workspaceId);
    const lifecycleRef = this.ownerLifecycleRef(userId);
    const prepared = await this.db.runTransaction(async (transaction) => {
      const [workspace, lifecycle, applications, events] = await Promise.all([
        transaction.get(workspaceRef),
        transaction.get(lifecycleRef),
        transaction.get(this.apps.where("demoWorkspaceId", "==", workspaceId)),
        transaction.get(this.events.where("demoWorkspaceId", "==", workspaceId)),
      ]);
      if (!workspace.exists) return null;
      const workspaceData = workspace.data()!;
      if (workspaceData.userId !== userId) throw new Error("not_found");
      if (workspaceData.state === "creating") throw new Error("demo_workspace_unavailable");
      if (lifecycle.exists && (lifecycle.data()!.userId !== userId || lifecycle.data()!.workspaceId !== workspaceId)) {
        throw new Error("demo_marker_conflict");
      }
      for (const document of applications.docs) {
        const data = document.data();
        if (data.userId !== userId || data.isDemo !== true || data.demoWorkspaceId !== workspaceId || typeof data.demoKey !== "string") {
          throw new Error("demo_marker_conflict");
        }
      }
      for (const document of events.docs) {
        const data = document.data();
        if (data.userId !== userId || data.isDemo !== true || data.demoWorkspaceId !== workspaceId || typeof data.demoKey !== "string") {
          throw new Error("demo_marker_conflict");
        }
      }
      const currentApplicationIds = applications.docs.map((document) => document.id);
      const applicationIds = workspaceData.state === "deleting"
        ? workspaceData.deletionApplicationIds
        : currentApplicationIds;
      const applicationCount = workspaceData.state === "deleting"
        ? workspaceData.deletionApplicationCount
        : currentApplicationIds.length;
      // Persist the preparation-time count so retries return one stable best-effort
      // value. Events racing preparation are still cleaned up below, but are not
      // retroactively included in the public deletion count.
      const eventCount = workspaceData.state === "deleting"
        ? workspaceData.deletionEventCount
        : events.docs.length;
      if (
        !Array.isArray(applicationIds)
        || applicationIds.some((id) => typeof id !== "string")
        || typeof applicationCount !== "number"
        || applicationCount !== applicationIds.length
        || typeof eventCount !== "number"
        || currentApplicationIds.some((id) => !applicationIds.includes(id))
      ) throw new Error("demo_deletion_incomplete");
      const deletionMetadata = {
        deletionApplicationIds: applicationIds,
        deletionApplicationCount: applicationCount,
        deletionEventCount: eventCount,
      };
      transaction.update(workspaceRef, {
        state: "deleting",
        ...deletionMetadata,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(lifecycleRef, {
        userId,
        mode: "deleting",
        workspaceId,
        ...deletionMetadata,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { applications: applications.docs, applicationIds, applicationCount, eventCount };
    });
    if (!prepared) return { deletedApplications: 0, deletedEvents: 0 };

    // Reuse the retryable application cascade so contacts, submissions, document links,
    // CV patches, canonical indexes and every application event are handled consistently.
    for (const application of prepared.applications) {
      await this.deleteApplicationCascade(application.id, userId);
    }

    // An event can commit after a cascade has read its event snapshot but before the
    // application is removed. No new event can pass the parent transaction once all
    // applications are gone, so sweep those late arrivals without changing the stable
    // preparation-time count returned to callers.
    const lateEvents = await this.events.where("demoWorkspaceId", "==", workspaceId).get();
    for (const document of lateEvents.docs) {
      const data = document.data();
      if (data.userId !== userId || data.isDemo !== true || data.demoWorkspaceId !== workspaceId) {
        throw new Error("demo_marker_conflict");
      }
    }
    for (let offset = 0; offset < lateEvents.docs.length; offset += 450) {
      const batch = this.db.batch();
      for (const document of lateEvents.docs.slice(offset, offset + 450)) batch.delete(document.ref);
      await batch.commit();
    }

    const remnants: FirebaseFirestore.QuerySnapshot[] = await Promise.all([
      this.apps.where("demoWorkspaceId", "==", workspaceId).get(),
      this.events.where("demoWorkspaceId", "==", workspaceId).get(),
      ...prepared.applicationIds.flatMap((applicationId) => [
        this.contacts.where("applicationId", "==", applicationId).get(),
        this.submissions.where("applicationId", "==", applicationId).get(),
        this.events.where("applicationId", "==", applicationId).get(),
        this.docs.where("applicationIds", "array-contains", applicationId).get(),
        this.canonicalUrls.where("applicationId", "==", applicationId).get(),
      ]),
    ]);
    const patchRemnants = await Promise.all(
      prepared.applicationIds.map((applicationId) => this.db.collection("cvPatches").doc(applicationId).get()),
    );
    if (remnants.some((snapshot) => !snapshot.empty) || patchRemnants.some((snapshot) => snapshot.exists)) {
      throw new Error("demo_deletion_incomplete");
    }
    await this.db.runTransaction(async (transaction) => {
      const [workspace, lifecycle] = await Promise.all([
        transaction.get(workspaceRef),
        transaction.get(lifecycleRef),
      ]);
      if (!workspace.exists) return;
      if (
        workspace.data()!.userId !== userId
        || workspace.data()!.state !== "deleting"
        || !lifecycle.exists
        || lifecycle.data()!.userId !== userId
        || lifecycle.data()!.mode !== "deleting"
        || JSON.stringify(workspace.data()!.deletionApplicationIds) !== JSON.stringify(prepared.applicationIds)
        || workspace.data()!.deletionApplicationCount !== prepared.applicationCount
        || workspace.data()!.deletionEventCount !== prepared.eventCount
      ) throw new Error("demo_deletion_incomplete");
      transaction.delete(workspaceRef);
      transaction.delete(lifecycleRef);
    });
    return { deletedApplications: prepared.applicationCount, deletedEvents: prepared.eventCount };
  }

  // ── Applications ────────────────────────────────────────────────────────

  async listApplications(userId: string | null, options?: DemoReadOptions): Promise<ApplicationRecord[]> {
    let q: FirebaseFirestore.Query = this.apps.orderBy("createdAt", "desc");
    if (userId !== null) q = q.where("userId", "==", userId);
    const snap = await q.get();
    const applications = snap.docs
      .filter((document) => isDemoVisible(document.data(), options))
      .map((document) => mapApp(document.id, document.data()));

    // Batch-load contacts for all applications
    const appIds = applications.map((a) => a.id);
    if (appIds.length > 0) {
      const contactsByApp = await this.loadContactsByAppIds(appIds);
      for (const app of applications) {
        app.contacts = contactsByApp.get(app.id) ?? [];
      }
    }
    return applications;
  }

  async listApplicationsPaginated(
    userId: string | null,
    params: PaginationParams,
    options?: DemoReadOptions,
  ): Promise<PaginatedResult<ApplicationRecord>> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize ?? 10));

    // Firestore doesn't support count + offset natively, so we fetch all IDs
    let q: FirebaseFirestore.Query = this.apps.orderBy("createdAt", "desc");
    if (userId !== null) q = q.where("userId", "==", userId);

    const snap = await q.get();
    const visibleDocs = snap.docs.filter((document) => isDemoVisible(document.data(), options));
    const total = visibleDocs.length;
    const totalPages = Math.ceil(total / pageSize);

    const start = (page - 1) * pageSize;
    const pageDocs = visibleDocs.slice(start, start + pageSize);
    const applications = pageDocs.map((d) => mapApp(d.id, d.data()));

    // Batch-load contacts for the page
    const appIds = applications.map((a) => a.id);
    if (appIds.length > 0) {
      const contactsByApp = await this.loadContactsByAppIds(appIds);
      for (const app of applications) {
        app.contacts = contactsByApp.get(app.id) ?? [];
      }
    }

    return { data: applications, total, page, pageSize, totalPages };
  }

  async getApplication(id: string, userId: string | null, options?: DemoReadOptions): Promise<ApplicationRecord | null> {
    const doc = await this.apps.doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data()!;
    if (userId !== null && data.userId !== userId) return null;
    if (!isDemoVisible(data, options)) return null;

    const app = mapApp(id, data);
    // Load contacts
    const contactSnap = await this.contacts.where("applicationId", "==", id).get();
    app.contacts = contactSnap.docs.map((d) => mapContact(d.id, d.data()));
    return app;
  }

  async createApplication(userId: string, data: CreateApplicationInput): Promise<ApplicationRecord> {
    validateApplicationSummary(data.notes);
    const now = Timestamp.now();
    const reference = this.apps.doc();
    const payload = {
      userId,
      company: data.company,
      role: data.role,
      status: normalizeStatus(data.status),
      appliedAt: toTimestamp(resolveAppliedAtForCreate(data.status, data.appliedAt)),
      lastContact: toTimestamp(data.lastContact),
      followUpAt: toTimestamp(data.followUpAt),
      notes: data.notes,
      jobDescription: data.jobDescription,
      source: data.source,
      remote: data.remote ?? false,
      salaryMin: data.salaryMin ?? null,
      salaryMax: data.salaryMax ?? null,
      rating: data.rating ?? null,
      jobUrl: data.jobUrl ?? null,
      resumeId: data.resumeId ?? null,
      companySize: data.companySize ?? null,
      salaryBandMentioned: data.salaryBandMentioned ?? false,
      triageQuality: data.triageQuality ?? null,
      triageReason: data.triageReason ?? null,
      incomingSource: data.incomingSource ?? null,
      autoRejected: data.autoRejected ?? false,
      autoRejectReason: data.autoRejectReason ?? null,
      isDemo: false,
      demoWorkspaceId: null,
      demoKey: null,
      ...structuredMetadataForFirestore(data as unknown as Record<string, unknown>),
      createdAt: now,
      updatedAt: now,
    };
    await this.db.runTransaction(async (transaction) => {
      const lifecycleRef = this.ownerLifecycleRef(userId);
      const workspaceRef = this.demoWorkspaces.doc(submissionRequestHash({ kind: "demo-workspace", userId }));
      const [lifecycle, workspace] = await Promise.all([
        transaction.get(lifecycleRef),
        transaction.get(workspaceRef),
      ]);
      if (lifecycle.exists && lifecycle.data()!.userId !== userId) throw new Error("demo_marker_conflict");
      if (workspace.exists || (lifecycle.exists && lifecycle.data()!.mode !== "real")) {
        throw new Error("demo_workspace_exists");
      }
      if (data.canonicalJobUrl) {
        const indexReference = this.canonicalUrlRef(userId, data.canonicalJobUrl);
        const duplicate = await transaction.get(indexReference);
        if (duplicate.exists) throw new Error("canonical_job_url_conflict");
        transaction.create(indexReference, {
          userId,
          canonicalJobUrl: data.canonicalJobUrl,
          applicationId: reference.id,
          createdAt: now,
        });
      }
      transaction.set(lifecycleRef, { userId, mode: "real", updatedAt: now });
      transaction.create(reference, payload);
    });
    const app = mapApp(reference.id, payload);
    app.contacts = [];
    return app;
  }

  async updateApplication(id: string, userId: string, data: UpdateApplicationInput): Promise<ApplicationRecord> {
    const ref = this.apps.doc(id);
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (data.company !== undefined) update.company = data.company;
    if (data.role !== undefined) update.role = data.role;
    if (data.status !== undefined) update.status = normalizeStatus(data.status);
    if (data.appliedAt !== undefined) update.appliedAt = toTimestamp(data.appliedAt);
    if (data.lastContact !== undefined) update.lastContact = toTimestamp(data.lastContact);
    if (data.followUpAt !== undefined) update.followUpAt = toTimestamp(data.followUpAt);
    if (data.notes !== undefined) update.notes = data.notes;
    if (data.jobDescription !== undefined) update.jobDescription = data.jobDescription;
    if (data.source !== undefined) update.source = data.source;
    if (data.remote !== undefined) update.remote = data.remote;
    if (data.salaryMin !== undefined) update.salaryMin = data.salaryMin;
    if (data.salaryMax !== undefined) update.salaryMax = data.salaryMax;
    if (data.rating !== undefined) update.rating = data.rating;
    if (data.jobUrl !== undefined) update.jobUrl = data.jobUrl;
    if (data.resumeId !== undefined) update.resumeId = data.resumeId;
    if (data.companySize !== undefined) update.companySize = data.companySize;
    if (data.salaryBandMentioned !== undefined) update.salaryBandMentioned = data.salaryBandMentioned;
    if (data.triageQuality !== undefined) update.triageQuality = data.triageQuality;
    if (data.triageReason !== undefined) update.triageReason = data.triageReason;
    if (data.incomingSource !== undefined) update.incomingSource = data.incomingSource;
    if (data.autoRejected !== undefined) update.autoRejected = data.autoRejected;
    if (data.autoRejectReason !== undefined) update.autoRejectReason = data.autoRejectReason;
    if (data.archivedAt !== undefined) update.archivedAt = toTimestamp(data.archivedAt);
    Object.assign(update, structuredMetadataForFirestore(data as unknown as Record<string, unknown>));

    await this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (!existing.exists || existing.data()!.userId !== userId) throw new Error("not_found");
      if (existing.data()!.deletionState === "in_progress") throw new Error("application_deleting");
      if (data.notes !== undefined) {
        if (existing.data()!.notes === data.notes) delete update.notes;
        else {
          validateApplicationSummary(data.notes);
          update.notes = data.notes;
        }
      }
      const currentCanonicalJobUrl = existing.data()!.canonicalJobUrl as string | null | undefined;
      let nextCanonicalIndex: FirebaseFirestore.DocumentReference | null = null;
      let nextCanonicalIndexExists = false;
      if (data.canonicalJobUrl) {
        nextCanonicalIndex = this.canonicalUrlRef(userId, data.canonicalJobUrl);
        const duplicate = await transaction.get(nextCanonicalIndex);
        if (duplicate.exists && duplicate.data()!.applicationId !== id) {
          throw new Error("canonical_job_url_conflict");
        }
        nextCanonicalIndexExists = duplicate.exists;
      }
      if (data.expectedUpdatedAt) {
        const currentUpdatedAt = toDate(existing.data()!.updatedAt);
        if (!currentUpdatedAt || currentUpdatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
          throw new Error("conflict");
        }
      }
      if (data.canonicalJobUrl !== undefined) {
        if (currentCanonicalJobUrl && currentCanonicalJobUrl !== data.canonicalJobUrl) {
          transaction.delete(this.canonicalUrlRef(userId, currentCanonicalJobUrl));
        }
        if (nextCanonicalIndex && !nextCanonicalIndexExists) {
          transaction.set(nextCanonicalIndex, {
            userId,
            canonicalJobUrl: data.canonicalJobUrl,
            applicationId: id,
            createdAt: Timestamp.now(),
          });
        }
      }
      transaction.update(ref, update);
    });
    return (await this.getApplication(id, userId))!;
  }

  private async deleteApplicationCascade(id: string, userId: string): Promise<void> {
    const ref = this.apps.doc(id);
    const deletingDemo = await this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (!existing.exists || existing.data()!.userId !== userId) throw new Error("not_found");
      transaction.update(ref, {
        deletionState: "in_progress",
        deletionStartedAt: FieldValue.serverTimestamp(),
      });
      return existing.data()!.isDemo === true;
    });

    // Career Ops conversations are detached before the cascade so a failure
    // later cannot leave a thread pointing at a deleted application.
    await this.clearCareerOpsApplicationLinks(id, userId);

    const [contactSnap, submissionSnap, eventSnap, linkedDocumentSnap] = await Promise.all([
      this.contacts.where("applicationId", "==", id).get(),
      this.submissions.where("applicationId", "==", id).where("userId", "==", userId).get(),
      this.events.where("applicationId", "==", id).where("userId", "==", userId).get(),
      this.docs.where("userId", "==", userId).where("applicationIds", "array-contains", id).get(),
    ]);
    const submissionIds = submissionSnap.docs.map((document) => document.id);
    const deletedSubmissionIds = new Set(submissionIds);
    const documents = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    linkedDocumentSnap.docs.forEach((document) => documents.set(document.id, document));
    for (let offset = 0; offset < submissionIds.length; offset += 30) {
      const snapshot = await this.docs
        .where("userId", "==", userId)
        .where("submissionId", "in", submissionIds.slice(offset, offset + 30))
        .get();
      snapshot.docs.forEach((document) => documents.set(document.id, document));
    }

    // Preserve and detach every document before deleting any submission. This ordering
    // makes the multi-batch cascade retryable: while document batches are incomplete,
    // submission rows remain available to rediscover every submitted artifact. Once a
    // submission deletion starts, all associated documents have already been preserved.
    const documentOperations = Array.from(documents.values()).map((document) => {
      const data = document.data();
      const submissionId = typeof data.submissionId === "string" ? data.submissionId : null;
      const belongsToDeletedSubmission = submissionId !== null && deletedSubmissionIds.has(submissionId);
      return {
        type: "update" as const,
        ref: document.ref,
        data: {
          applicationIds: FieldValue.arrayRemove(id),
          ...(deletingDemo && { demoProvenance: true }),
          ...(belongsToDeletedSubmission && {
            submissionId: null,
            state: "historical",
          }),
        },
      };
    });
    const operations: Array<
      | { type: "delete"; ref: FirebaseFirestore.DocumentReference }
      | { type: "update"; ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }
    > = [
      ...documentOperations,
      ...contactSnap.docs.map((document) => ({ type: "delete" as const, ref: document.ref })),
      ...eventSnap.docs.map((document) => ({ type: "delete" as const, ref: document.ref })),
      ...submissionSnap.docs.map((document) => ({ type: "delete" as const, ref: document.ref })),
    ];
    for (let offset = 0; offset < operations.length; offset += 450) {
      const batch = this.db.batch();
      for (const operation of operations.slice(offset, offset + 450)) {
        if (operation.type === "delete") batch.delete(operation.ref);
        else batch.update(operation.ref, operation.data);
      }
      await batch.commit();
    }
    await this.db.runTransaction(async (transaction) => {
      const patchRef = this.db.collection("cvPatches").doc(id);
      const [current, patch] = await Promise.all([
        transaction.get(ref),
        transaction.get(patchRef),
      ]);
      if (!current.exists) return;
      if (current.data()!.userId !== userId || current.data()!.deletionState !== "in_progress") {
        throw new Error("application_delete_conflict");
      }
      if (patch.exists && (patch.data()!.userId !== userId || patch.data()!.applicationId !== id)) {
        throw new Error("application_delete_conflict");
      }
      const canonicalJobUrl = current.data()!.canonicalJobUrl as string | null | undefined;
      if (canonicalJobUrl) transaction.delete(this.canonicalUrlRef(userId, canonicalJobUrl));
      if (patch.exists) transaction.delete(patchRef);
      transaction.delete(ref);
    });
  }

  async deleteApplication(id: string, userId: string): Promise<void> {
    await this.deleteApplicationCascade(id, userId);
  }

  async findApplicationByCanonicalJobUrl(
    userId: string,
    canonicalJobUrl: string,
    options?: DemoReadOptions,
  ): Promise<ApplicationRecord | null> {
    const snapshot = await this.apps
      .where("userId", "==", userId)
      .where("canonicalJobUrl", "==", canonicalJobUrl)
      .get();
    const document = snapshot.docs.find((candidate) => isDemoVisible(candidate.data(), options));
    if (!document) return null;
    return mapApp(document.id, document.data());
  }

  async appendApplicationNote(
    id: string,
    userId: string,
    note: string,
    eventInput: CreateApplicationEventInput,
  ): Promise<{ application: ApplicationRecord; event: ApplicationEventRecord }> {
    const requestHash = submissionRequestHash({ applicationId: id, note, type: eventInput.type });
    const eventId = submissionRequestHash({
      userId,
      key: eventInput.idempotencyKey ?? requestHash,
    }).slice(0, 40);
    const result = await this.db.runTransaction(async (transaction) => {
      const appRef = this.apps.doc(id);
      const eventRef = this.events.doc(eventId);
      const [appSnapshot, eventSnapshot] = await Promise.all([
        transaction.get(appRef),
        transaction.get(eventRef),
      ]);
      if (!appSnapshot.exists || appSnapshot.data()!.userId !== userId) throw new Error("not_found");
      if (appSnapshot.data()!.deletionState === "in_progress") throw new Error("application_deleting");
      if (eventSnapshot.exists) {
        if (eventSnapshot.data()!.requestHash !== requestHash) throw new Error("idempotency_conflict");
        assertFirestoreEventMatchesParent(eventSnapshot.data()!, appSnapshot.data()!);
        return { appData: appSnapshot.data()!, eventData: eventSnapshot.data()! };
      }
      if (eventInput.expectedUpdatedAt) {
        const currentUpdatedAt = toDate(appSnapshot.data()!.updatedAt);
        if (!currentUpdatedAt || currentUpdatedAt.getTime() !== eventInput.expectedUpdatedAt.getTime()) {
          throw new Error("conflict");
        }
      }
      const existingNotes = appSnapshot.data()!.notes as string | null | undefined;
      const notes = existingNotes ? `${existingNotes}\n\n${note}` : note;
      if (notes.length > 10_000) throw new Error("notes_too_long");
      const now = Timestamp.now();
      const eventData = {
        userId,
        applicationId: id,
        type: eventInput.type,
        idempotencyKey: eventInput.idempotencyKey ?? null,
        requestHash,
        occurredAt: toTimestamp(eventInput.occurredAt),
        source: eventInput.source ?? null,
        actor: eventInput.actor ?? null,
        metadata: eventInput.metadata ?? {},
        createdAt: now,
        ...firestoreEventDemoData(appSnapshot.data()!, requestHash),
      };
      transaction.update(appRef, { notes, updatedAt: now });
      transaction.create(eventRef, eventData);
      return { appData: { ...appSnapshot.data()!, notes, updatedAt: now }, eventData };
    });
    return {
      application: mapApp(id, result.appData),
      event: mapEvent(eventId, result.eventData),
    };
  }

  async recordApplicationSubmission(
    userId: string,
    input: RecordSubmissionInput,
  ): Promise<RecordSubmissionResult> {
    const rawRequestHash = submissionInputRequestHash(input as unknown as Record<string, unknown>);
    let validatedPolicy: ReturnType<typeof validateSubmissionPolicy> | null = null;
    let policyError: unknown = null;
    try {
      validatedPolicy = validateSubmissionPolicy({
        policy: input.policy,
        answers: input.answers,
        documentIds: input.documentIds,
      });
    } catch (error) {
      policyError = error;
    }
    const normalizedRequestHash = validatedPolicy
      ? submissionInputRequestHash({ ...input, policy: validatedPolicy } as unknown as Record<string, unknown>)
      : rawRequestHash;
    const acceptedReplayHashes = submissionReplayRequestHashes(
      input as unknown as Record<string, unknown>,
      validatedPolicy,
    );
    const submissionId = submissionRequestHash({ userId, key: input.idempotencyKey }).slice(0, 40);
    const eventId = `submission-${submissionId}`;

    const outcome = await this.db.runTransaction(async (transaction) => {
      const submissionRef = this.submissions.doc(submissionId);
      const existingSubmission = await transaction.get(submissionRef);
      if (existingSubmission.exists) {
        const existingData = existingSubmission.data()!;
        if (existingData.userId !== userId || !acceptedReplayHashes.has(existingData.requestHash)) {
          throw new Error("idempotency_conflict");
        }
        return { replayed: true, dryRun: false };
      }
      const policy = validatedPolicy;
      if (!policy) {
        throw policyError instanceof Error ? policyError : new Error("human_review_required");
      }
      const requestHash = normalizedRequestHash;
      const documentIds = validateSubmissionDocumentIds(input.documentIds);

      const appRef = this.apps.doc(input.applicationId);
      const appSnapshot = await transaction.get(appRef);
      if (!appSnapshot.exists || appSnapshot.data()!.userId !== userId) throw new Error("not_found");
      const appData = appSnapshot.data()!;
      firestoreEventDemoData(appData, normalizedRequestHash);
      if (appData.deletionState === "in_progress") throw new Error("application_deleting");
      if (input.expectedUpdatedAt) {
        const updatedAt = toDate(appData.updatedAt);
        if (!updatedAt || updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
          throw new Error("conflict");
        }
      }

      const effectiveAtsName = input.atsName !== undefined
        ? input.atsName
        : (typeof appData.atsName === "string" ? appData.atsName : null);
      const effectiveRequisitionId = input.requisitionId !== undefined
        ? input.requisitionId
        : (typeof appData.requisitionId === "string" ? appData.requisitionId : null);
      // Reading the owner's complete application set into this transaction is
      // intentional: it makes same-company and duplicate-requisition checks race-safe
      // and mirrors Prisma's owner-wide serialization boundary.
      const [existingApplicationSubmissions, ownerApplications] = await Promise.all([
        transaction.get(
          this.submissions
            .where("applicationId", "==", input.applicationId)
            .where("userId", "==", userId),
        ),
        transaction.get(this.apps.where("userId", "==", userId)),
      ]);
      validateSubmissionConflicts({
        applicationId: input.applicationId,
        company: String(appData.company ?? ""),
        requisitionId: effectiveRequisitionId,
        atsName: effectiveAtsName,
        existingSubmissionCount: existingApplicationSubmissions.docs.length,
        policy,
        applications: ownerApplications.docs.map((snapshot) => {
          const data = snapshot.data();
          return {
            id: snapshot.id,
            company: String(data.company ?? ""),
            status: normalizeStatus(String(data.status ?? "inbound")),
            requisitionId: typeof data.requisitionId === "string" ? data.requisitionId : null,
            atsName: typeof data.atsName === "string" ? data.atsName : null,
          };
        }),
      });

      const uniqueDocumentIds = documentIds;
      const documentSnapshots: FirebaseFirestore.DocumentSnapshot[] = [];
      for (const documentId of uniqueDocumentIds) {
        const snapshot = await transaction.get(this.docs.doc(documentId));
        if (!snapshot.exists || snapshot.data()!.userId !== userId) throw new Error("invalid_documents");
        if (
          snapshot.data()!.submissionId
          || snapshot.data()!.state === "submitted"
          || snapshot.data()!.state === "historical"
        ) throw new Error("document_already_submitted");
        documentSnapshots.push(snapshot);
      }

      const now = Timestamp.now();
      const submissionData = {
        userId,
        applicationId: input.applicationId,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        submittedAt: toTimestamp(input.submittedAt),
        applicationUrl: input.applicationUrl ?? null,
        atsName: effectiveAtsName,
        requisitionId: effectiveRequisitionId,
        language: input.language ?? null,
        answers: input.answers,
        policy,
        candidateSalaryMin: input.candidateSalaryMin ?? null,
        candidateSalaryMax: input.candidateSalaryMax ?? null,
        candidateSalaryCurrency: input.candidateSalaryCurrency ?? null,
        candidateSalaryPeriod: input.candidateSalaryPeriod ?? null,
        candidateSalaryType: input.candidateSalaryType ?? null,
        candidateSalaryFlexible: input.candidateSalaryFlexible ?? false,
        documentIds: uniqueDocumentIds,
        createdAt: now,
      };
      if (input.dryRun) {
        return { replayed: false, dryRun: true, appData, submissionData, documentSnapshots };
      }

      const eventData = {
        userId,
        applicationId: input.applicationId,
        type: "application_submitted",
        occurredAt: toTimestamp(input.submittedAt),
        source: input.source ?? "mcp",
        actor: input.actor ?? null,
        metadata: {
          submissionId,
          documentIds: uniqueDocumentIds,
          answerCount: input.answers.length,
          policy,
        },
        createdAt: now,
        ...firestoreEventDemoData(appData, normalizedRequestHash),
      };
      transaction.create(submissionRef, submissionData);
      transaction.create(this.events.doc(eventId), eventData);
      transaction.update(appRef, {
        status: "applied",
        appliedAt: toTimestamp(input.submittedAt),
        ...(input.followUpAt !== undefined ? { followUpAt: toTimestamp(input.followUpAt) } : {}),
        ...(input.atsName !== undefined ? { atsName: input.atsName } : {}),
        ...(input.requisitionId !== undefined ? { requisitionId: input.requisitionId } : {}),
        updatedAt: now,
      });
      documentSnapshots.forEach((snapshot) =>
        transaction.update(snapshot.ref, {
          state: "submitted",
          submittedAt: toTimestamp(input.submittedAt),
          submissionId,
        }),
      );
      return { replayed: false, dryRun: false };
    });

    if (outcome.dryRun && outcome.appData && outcome.submissionData && outcome.documentSnapshots) {
      const documents = outcome.documentSnapshots.map((snapshot) =>
        mapDoc(snapshot.id, {
          ...snapshot.data()!,
          state: "submitted",
          submittedAt: toTimestamp(input.submittedAt),
          submissionId,
        }),
      );
      const application = mapApp(input.applicationId, {
        ...outcome.appData,
        status: "applied",
        appliedAt: toTimestamp(input.submittedAt),
        ...(input.followUpAt !== undefined ? { followUpAt: toTimestamp(input.followUpAt) } : {}),
        ...(input.atsName !== undefined ? { atsName: input.atsName } : {}),
        ...(input.requisitionId !== undefined ? { requisitionId: input.requisitionId } : {}),
      });
      return {
        replayed: false,
        dryRun: true,
        verified: true,
        application,
        submission: { ...mapSubmission("dry-run", outcome.submissionData), documents },
        event: null,
        documents,
      };
    }

    const [application, submission, event] = await Promise.all([
      this.getApplication(input.applicationId, userId),
      this.getApplicationSubmission(submissionId, userId),
      this.events.doc(eventId).get(),
    ]);
    if (!application || !submission) throw new Error("verification_failed");
    if (event.exists) assertFirestoreEventMatchesParent(event.data()!, application);
    const documents = await Promise.all(
      submission.documentIds.map(async (documentId) => {
        const document = await this.getDocument(documentId, userId);
        if (!document) throw new Error("verification_failed");
        return document;
      }),
    );
    submission.documents = documents;
    return {
      replayed: outcome.replayed,
      dryRun: false,
      verified:
        application.status === "applied" &&
        application.appliedAt?.getTime() === input.submittedAt.getTime() &&
        documents.length === submission.documentIds.length,
      application,
      submission,
      event: event.exists ? mapEvent(event.id, event.data()!) : null,
      documents,
    };
  }

  private async resolveSubmissionDocuments(
    submission: ApplicationSubmissionRecord,
    userId: string,
  ): Promise<ApplicationSubmissionRecord> {
    const documents = await Promise.all(
      submission.documentIds.map(async (documentId) => {
        const document = await this.getDocument(documentId, userId);
        if (!document || document.submissionId !== submission.id) {
          throw new Error("verification_failed");
        }
        return document;
      }),
    );
    return { ...submission, documents };
  }

  async listApplicationSubmissions(
    applicationId: string,
    userId: string,
    includeAnswers = false,
  ): Promise<ApplicationSubmissionRecord[]> {
    const application = await this.getApplication(applicationId, userId);
    if (!application) throw new Error("not_found");
    const snapshot = await this.submissions
      .where("applicationId", "==", applicationId)
      .where("userId", "==", userId)
      .orderBy("submittedAt", "desc")
      .get();
    return Promise.all(
      snapshot.docs.map((document) =>
        this.resolveSubmissionDocuments(
          mapSubmission(document.id, document.data(), includeAnswers),
          userId,
        ),
      ),
    );
  }

  async listUserSubmissions(userId: string): Promise<ApplicationSubmissionRecord[]> {
    const snapshot = await this.submissions
      .where("userId", "==", userId)
      .orderBy("submittedAt", "desc")
      .get();
    return snapshot.docs.map((document) => mapSubmission(document.id, document.data()));
  }

  async getApplicationSubmission(
    id: string,
    userId: string,
  ): Promise<ApplicationSubmissionRecord | null> {
    const snapshot = await this.submissions.doc(id).get();
    if (!snapshot.exists || snapshot.data()!.userId !== userId) return null;
    const submission = mapSubmission(id, snapshot.data()!);
    const application = await this.getApplication(submission.applicationId, userId);
    if (!application) return null;
    return this.resolveSubmissionDocuments(submission, userId);
  }

  async createApplicationEvent(
    applicationId: string,
    userId: string,
    input: CreateApplicationEventInput,
  ): Promise<ApplicationEventRecord> {
    const requestHash = submissionRequestHash({
      applicationId,
      type: input.type,
      occurredAt: input.occurredAt,
      metadata: input.metadata ?? {},
    });
    const eventId = input.idempotencyKey
      ? submissionRequestHash({ userId, key: input.idempotencyKey }).slice(0, 40)
      : this.events.doc().id;
    const eventRef = this.events.doc(eventId);
    const eventData = await this.db.runTransaction(async (transaction) => {
      const appRef = this.apps.doc(applicationId);
      const [application, existing] = await Promise.all([
        transaction.get(appRef),
        transaction.get(eventRef),
      ]);
      if (!application.exists || application.data()!.userId !== userId) throw new Error("not_found");
      if (application.data()!.deletionState === "in_progress") throw new Error("application_deleting");
      if (existing.exists) {
        if (!input.idempotencyKey || existing.data()!.userId !== userId || existing.data()!.requestHash !== requestHash) {
          throw new Error("idempotency_conflict");
        }
        assertFirestoreEventMatchesParent(existing.data()!, application.data()!);
        return existing.data()!;
      }
      const data = {
        userId,
        applicationId,
        type: input.type,
        idempotencyKey: input.idempotencyKey ?? null,
        requestHash,
        occurredAt: toTimestamp(input.occurredAt),
        source: input.source ?? null,
        actor: input.actor ?? null,
        metadata: input.metadata ?? {},
        createdAt: Timestamp.now(),
        ...firestoreEventDemoData(application.data()!, requestHash),
      };
      transaction.create(eventRef, data);
      return data;
    });
    return mapEvent(eventId, eventData);
  }

  async recordApplicationEvent(
    applicationId: string,
    userId: string,
    input: RecordApplicationEventInput,
  ): Promise<RecordApplicationEventResult> {
    const requestHash = submissionRequestHash({
      applicationId,
      type: input.type,
      occurredAt: input.occurredAt,
      source: input.source ?? null,
      actor: input.actor ?? null,
      metadata: input.metadata ?? {},
      contactId: input.contactId ?? null,
      outcome: input.outcome ?? null,
      expectedUpdatedAt: input.expectedUpdatedAt ?? null,
    });
    const legacyRequestHash = submissionRequestHash({
      applicationId,
      type: input.type,
      occurredAt: input.occurredAt,
      metadata: input.metadata ?? {},
    });
    const acceptedRequestHashes = new Set([requestHash, legacyRequestHash]);
    const eventId = input.idempotencyKey
      ? submissionRequestHash({ userId, key: input.idempotencyKey }).slice(0, 40)
      : this.events.doc().id;
    const eventRef = this.events.doc(eventId);
    const appRef = this.apps.doc(applicationId);

    const transactionResult = await this.db.runTransaction(async (transaction) => {
      const [application, existing] = await Promise.all([
        transaction.get(appRef),
        transaction.get(eventRef),
      ]);
      if (!application.exists || application.data()!.userId !== userId) throw new Error("not_found");
      const applicationData = application.data()!;
      if (applicationData.deletionState === "in_progress") throw new Error("application_deleting");
      if (existing.exists) {
        const existingData = existing.data()!;
        const persistedRequestHash = existingData.requestHash ?? existingData.metadata?.requestHash;
        if (
          !input.idempotencyKey
          || existingData.userId !== userId
          || typeof persistedRequestHash !== "string"
          || !acceptedRequestHashes.has(persistedRequestHash)
        ) throw new Error("idempotency_conflict");
        assertFirestoreEventMatchesParent(existingData, applicationData);
        return { replayed: true, eventData: existingData };
      }
      const metadataInput = input.metadata ?? {};
      if (input.contactId) {
        const contact = await transaction.get(this.contacts.doc(input.contactId));
        if (!contact.exists || contact.data()!.applicationId !== applicationId) {
          throw new Error("contact_not_found");
        }
      }
      const documentId = typeof metadataInput.documentId === "string" ? metadataInput.documentId : null;
      if (documentId) {
        const document = await transaction.get(this.docs.doc(documentId));
        const documentData = document.exists ? document.data()! : null;
        if (
          !documentData
          || documentData.userId !== userId
          || !Array.isArray(documentData.applicationIds)
          || !documentData.applicationIds.includes(applicationId)
        ) {
          throw new Error("document_not_found");
        }
      }
      const submissionId = typeof metadataInput.submissionId === "string" ? metadataInput.submissionId : null;
      if (submissionId) {
        const submission = await transaction.get(this.submissions.doc(submissionId));
        if (
          !submission.exists
          || submission.data()!.userId !== userId
          || submission.data()!.applicationId !== applicationId
        ) {
          throw new Error("submission_not_found");
        }
      }
      const updatedAt = toDate(applicationData.updatedAt);
      if (input.expectedUpdatedAt && updatedAt?.getTime() !== input.expectedUpdatedAt.getTime()) {
        throw new Error("conflict");
      }
      const { patch, metadata } = deriveEventProjection(
        { type: input.type, occurredAt: input.occurredAt, metadata: input.metadata ?? {} },
        {
        status: applicationData.status,
        currentStage: applicationData.currentStage ?? null,
        followUpAt: toDate(applicationData.followUpAt),
      });
      const firestorePatch = Object.fromEntries(
        Object.entries(patch).map(([key, value]) => [
          key,
          value instanceof Date ? toTimestamp(value) : value,
        ]),
      );
      transaction.update(appRef, { ...firestorePatch, updatedAt: Timestamp.now() });
      const eventData = {
        userId,
        applicationId,
        type: input.type,
        idempotencyKey: input.idempotencyKey ?? null,
        requestHash,
        occurredAt: toTimestamp(input.occurredAt),
        source: input.source ?? null,
        actor: input.actor ?? null,
        contactId: input.contactId ?? null,
        outcome: input.outcome ?? null,
        metadata,
        createdAt: Timestamp.now(),
        ...firestoreEventDemoData(applicationData, requestHash),
      };
      transaction.create(eventRef, eventData);
      return { replayed: false, eventData };
    });

    const application = await this.getApplication(applicationId, userId);
    if (!application) throw new Error("verification_failed");
    const eventSnapshot = await eventRef.get();
    if (!eventSnapshot.exists) throw new Error("verification_failed");
    return {
      event: mapEvent(eventId, eventSnapshot.data() ?? transactionResult.eventData),
      application,
      replayed: transactionResult.replayed,
    };
  }

  async listApplicationEventsFiltered(
    userId: string,
    filter: ListApplicationEventsFilter,
    options?: DemoReadOptions,
  ): Promise<ApplicationEventPage> {
    const direction = filter.order === "oldest" ? "asc" : "desc";
    let query: FirebaseFirestore.Query = this.events.where("userId", "==", userId);

    // Use one indexed equality dimension as the native narrowing predicate.
    // Remaining filters are applied to the bounded page below so arbitrary
    // combinations do not require a combinatorial set of Firestore indexes.
    if (filter.applicationId) query = query.where("applicationId", "==", filter.applicationId);
    else if (filter.types?.length) query = query.where("type", "in", filter.types);
    else if (filter.source) query = query.where("source", "==", filter.source);
    else if (filter.actor) query = query.where("actor", "==", filter.actor);
    else if (filter.contactId) query = query.where("contactId", "==", filter.contactId);
    else if (filter.outcome) query = query.where("outcome", "==", filter.outcome);

    if (filter.occurredAfter) {
      query = query.where("occurredAt", ">=", Timestamp.fromDate(filter.occurredAfter));
    }
    if (filter.occurredBefore) {
      query = query.where("occurredAt", "<=", Timestamp.fromDate(filter.occurredBefore));
    }
    query = query
      .orderBy("occurredAt", direction)
      .orderBy(FieldPath.documentId(), direction);
    if (filter.cursor) {
      query = query.startAfter(
        Timestamp.fromDate(new Date(filter.cursor.occurredAt)),
        filter.cursor.id,
      );
    }

    const scanLimit = Math.min(500, Math.max(filter.limit * 2, 50));
    const matchingEvents: Array<{
      document: FirebaseFirestore.QueryDocumentSnapshot;
      event: ApplicationEventRecord;
    }> = [];

    // Residual filters (notably company and arbitrary filter combinations) are
    // evaluated in memory. Keep advancing the indexed query until this logical
    // page has a real match/lookahead or the query is exhausted; never expose
    // internal scan windows as empty client pages.
    while (matchingEvents.length <= filter.limit) {
      const snapshot = await query.limit(scanLimit).get();
      if (!snapshot.docs.length) break;
      const scannedEvents = snapshot.docs.map((document) => ({
        document,
        event: mapEvent(document.id, document.data()),
      }));
      const parentMap = await this.loadVerifiedEventParents([
        ...new Set(scannedEvents.map(({ event }) => event.applicationId)),
      ], userId);
      for (const candidate of scannedEvents) {
        const parent = parentMap.get(candidate.event.applicationId);
        if (!isFirestoreEventVisibleWithParent(
          candidate.document.data(),
          parent?.data,
          userId,
          options,
        )) continue;
        candidate.event.application = parent?.summary;
        if (
          (!filter.applicationId || candidate.event.applicationId === filter.applicationId)
          && (!filter.company || candidate.event.application?.company.toLocaleLowerCase().includes(filter.company.toLocaleLowerCase()))
          && (!filter.types?.length || filter.types.includes(candidate.event.type))
          && (!filter.occurredAfter || candidate.event.occurredAt >= filter.occurredAfter)
          && (!filter.occurredBefore || candidate.event.occurredAt <= filter.occurredBefore)
          && (!filter.source || candidate.event.source === filter.source)
          && (!filter.actor || candidate.event.actor === filter.actor)
          && (!filter.contactId || candidate.event.contactId === filter.contactId)
          && (!filter.outcome || candidate.event.outcome === filter.outcome)
        ) matchingEvents.push(candidate);
      }
      if (matchingEvents.length > filter.limit || snapshot.docs.length < scanLimit) break;
      const lastDocument = snapshot.docs.at(-1)!;
      const lastEvent = mapEvent(lastDocument.id, lastDocument.data());
      query = query.startAfter(
        Timestamp.fromDate(lastEvent.occurredAt),
        lastEvent.id,
      );
    }

    const items = matchingEvents.slice(0, filter.limit).map(({ event }) => event);
    const cursorDocument = matchingEvents.length > filter.limit
      ? matchingEvents[filter.limit - 1]?.document
      : null;
    const cursorEvent = cursorDocument
      ? mapEvent(cursorDocument.id, cursorDocument.data())
      : null;
    return {
      items,
      nextCursor: cursorEvent
        ? encodeEventCursor({
          version: 1,
          occurredAt: cursorEvent.occurredAt.toISOString(),
          id: cursorEvent.id,
        })
        : null,
    };
  }

  async listApplicationEvents(
    applicationId: string,
    userId: string,
    limit = 100,
    options?: DemoReadOptions,
  ): Promise<ApplicationEventRecord[]> {
    const application = await this.apps.doc(applicationId).get();
    if (
      !application.exists
      || application.data()!.userId !== userId
      || !isDemoVisible(application.data()!, options)
    ) throw new Error("not_found");
    const applicationData = application.data()!;
    const queryLimit = Math.max(1, Math.min(500, limit));
    let query = this.events
      .where("applicationId", "==", applicationId)
      .where("userId", "==", userId)
      .orderBy("occurredAt", "desc")
      .orderBy(FieldPath.documentId(), "desc");
    const visibleEvents: ApplicationEventRecord[] = [];
    while (visibleEvents.length < queryLimit) {
      const remaining = queryLimit - visibleEvents.length;
      const snapshot = await query.limit(remaining).get();
      if (!snapshot.docs.length) break;
      for (const document of snapshot.docs) {
        if (isFirestoreEventVisibleWithParent(document.data(), applicationData, userId, options)) {
          visibleEvents.push(mapEvent(document.id, document.data()));
        }
      }
      if (snapshot.docs.length < remaining) break;
      const lastDocument = snapshot.docs.at(-1)!;
      const lastEvent = mapEvent(lastDocument.id, lastDocument.data());
      query = query.startAfter(Timestamp.fromDate(lastEvent.occurredAt), lastEvent.id);
    }
    return visibleEvents;
  }

  async listApplicationsFiltered(
    userId: string | null,
    filter: ListApplicationsFilter,
    options?: DemoReadOptions,
  ): Promise<Partial<ApplicationRecord>[]> {
    // Firestore has limited query capabilities, so we fetch and filter in memory
    let q: FirebaseFirestore.Query = this.apps.orderBy("createdAt", "desc");
    if (userId !== null) q = q.where("userId", "==", userId);
    if (filter.status?.length === 1) {
      q = q.where("status", "==", filter.status[0]);
    }
    if (filter.remote !== undefined) {
      q = q.where("remote", "==", filter.remote);
    }

    const snap = await q.get();
    let apps = snap.docs
      .filter((document) => isDemoVisible(document.data(), options))
      .map((document) => mapApp(document.id, document.data()));

    // In-memory filters for capabilities Firestore doesn't support natively
    if (filter.status && filter.status.length > 1) {
      const statusSet = new Set(filter.status);
      apps = apps.filter((a) => statusSet.has(a.status));
    }
    if (filter.ratingGte !== undefined) {
      apps = apps.filter((a) => a.rating !== null && a.rating >= filter.ratingGte!);
    }
    if (filter.triageQualityGte !== undefined) {
      apps = apps.filter((a) => a.triageQuality !== null && a.triageQuality >= filter.triageQualityGte!);
    }
    if (filter.search) {
      const term = filter.search.toLowerCase();
      apps = apps.filter(
        (a) =>
          a.company.toLowerCase().includes(term) ||
          a.role.toLowerCase().includes(term) ||
          (a.notes?.toLowerCase().includes(term) ?? false) ||
          (a.jobDescription?.toLowerCase().includes(term) ?? false)
      );
    }

    // Sort
    if (filter.sort) {
      const desc = filter.sort.startsWith("-");
      const field = desc ? filter.sort.slice(1) : filter.sort;
      const allowedSortFields = [
        "createdAt", "updatedAt", "company", "role", "status",
        "rating", "salaryMin", "salaryMax", "appliedAt", "lastContact",
        "triageQuality",
      ];
      if (allowedSortFields.includes(field)) {
        apps.sort((a, b) => {
          const av = a[field as keyof ApplicationRecord];
          const bv = b[field as keyof ApplicationRecord];
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return desc ? -cmp : cmp;
        });
      }
    }

    // Limit
    if (filter.limit) {
      apps = apps.slice(0, filter.limit);
    }

    // Load contacts if requested
    if (filter.includeContacts) {
      const appIds = apps.map((a) => a.id);
      if (appIds.length > 0) {
        const contactsByApp = await this.loadContactsByAppIds(appIds);
        for (const app of apps) {
          app.contacts = contactsByApp.get(app.id) ?? [];
        }
      }
    }

    // Field selection
    const fields = filter.fields;
    if (fields?.length) {
      return apps.map((app) => {
        const picked: Partial<ApplicationRecord> = {};
        for (const f of fields) {
          if (f in app) {
            const key = f as keyof ApplicationRecord;
            (picked as Record<string, unknown>)[f] = app[key];
          }
        }
        picked.id = app.id;
        return picked;
      });
    }

    return apps;
  }

  async batchUpsertApplications(userId: string, items: BatchUpsertItem[]): Promise<BatchUpsertResult> {
    const results: BatchUpsertResult["results"] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        if (item.id) {
          const lifecycleFields = ["status", "appliedAt", "lastContact", "followUpAt", "currentStage"] as const;
          if (lifecycleFields.some((field) => item[field] !== undefined)) {
            results.push({ index: i, id: item.id, operation: "updated", error: "lifecycle_event_required" });
            failed++;
            continue;
          }
          const update = { ...item } as BatchUpsertItem & { id?: string };
          delete update.id;
          const application = await this.updateApplication(
            item.id,
            userId,
            update as UpdateApplicationInput,
          );
          results.push({ index: i, id: application.id, operation: "updated" });
          succeeded++;
        } else {
          // Create
          if (!item.company || !item.role) {
            results.push({ index: i, id: "", operation: "created", error: "company and role are required for new applications" });
            failed++;
            continue;
          }
          const createData = {
            ...item,
            company: item.company,
            role: item.role,
            status: item.status ?? "inbound",
            appliedAt: item.appliedAt ?? null,
            lastContact: item.lastContact ?? null,
            followUpAt: item.followUpAt ?? null,
            notes: item.notes ?? null,
            jobDescription: item.jobDescription ?? null,
            source: item.source ?? null,
            remote: item.remote ?? false,
            salaryMin: item.salaryMin ?? null,
            salaryMax: item.salaryMax ?? null,
            rating: item.rating ?? null,
            jobUrl: item.jobUrl ?? null,
            resumeId: item.resumeId ?? null,
          } as CreateApplicationInput & { id?: string };
          delete createData.id;
          const application = await this.createApplication(userId, createData);
          results.push({ index: i, id: application.id, operation: "created" });
          succeeded++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        results.push({ index: i, id: item.id ?? "", operation: item.id ? "updated" : "created", error: msg });
        failed++;
      }
    }

    return { total: items.length, succeeded, failed, results };
  }

  async batchDeleteApplications(ids: string[], userId: string): Promise<BatchDeleteResult> {
    const results: BatchDeleteResult["results"] = [];
    let succeeded = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await this.deleteApplicationCascade(id, userId);
        results.push({ id, deleted: true });
        succeeded += 1;
      } catch (error) {
        results.push({
          id,
          deleted: false,
          error: error instanceof Error ? error.message : "delete_failed",
        });
        failed += 1;
      }
    }
    return { total: ids.length, succeeded, failed, results };
  }

  // ── Contacts ────────────────────────────────────────────────────────────

  async verifyApplicationOwner(id: string, userId: string): Promise<boolean> {
    const doc = await this.apps.doc(id).get();
    return doc.exists && doc.data()!.userId === userId;
  }

  async createContact(applicationId: string, userId: string, data: CreateContactInput): Promise<ContactRecord> {
    const reference = this.contacts.doc();
    const payload = {
      applicationId,
      name: data.name,
      email: data.email,
      phone: data.phone,
      role: data.role,
      linkedIn: data.linkedIn,
      createdAt: Timestamp.now(),
    };
    await this.db.runTransaction(async (transaction) => {
      const application = await transaction.get(this.apps.doc(applicationId));
      if (!application.exists || application.data()!.userId !== userId) throw new Error("not_found");
      if (application.data()!.deletionState === "in_progress") throw new Error("application_deleting");
      transaction.create(reference, payload);
    });
    return mapContact(reference.id, payload);
  }

  async updateContact(id: string, applicationId: string, userId: string, data: UpdateContactInput): Promise<ContactRecord> {
    const reference = this.contacts.doc(id);
    const update: Record<string, unknown> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.email !== undefined) update.email = data.email;
    if (data.phone !== undefined) update.phone = data.phone;
    if (data.role !== undefined) update.role = data.role;
    if (data.linkedIn !== undefined) update.linkedIn = data.linkedIn;
    await this.db.runTransaction(async (transaction) => {
      const [application, contact] = await Promise.all([
        transaction.get(this.apps.doc(applicationId)),
        transaction.get(reference),
      ]);
      if (!application.exists || application.data()!.userId !== userId) throw new Error("not_found");
      if (application.data()!.deletionState === "in_progress") throw new Error("application_deleting");
      if (!contact.exists || contact.data()!.applicationId !== applicationId) throw new Error("not_found");
      transaction.update(reference, update);
    });
    const snapshot = await reference.get();
    return mapContact(id, snapshot.data()!);
  }

  async deleteContact(id: string, applicationId: string, userId: string): Promise<void> {
    const reference = this.contacts.doc(id);
    await this.db.runTransaction(async (transaction) => {
      const [application, contact] = await Promise.all([
        transaction.get(this.apps.doc(applicationId)),
        transaction.get(reference),
      ]);
      if (!application.exists || application.data()!.userId !== userId) throw new Error("not_found");
      if (application.data()!.deletionState === "in_progress") throw new Error("application_deleting");
      if (!contact.exists || contact.data()!.applicationId !== applicationId) throw new Error("not_found");
      transaction.delete(reference);
    });
  }

  // ── Documents ───────────────────────────────────────────────────────────

  async listDocumentsByApplication(applicationId: string, userId: string): Promise<DocumentRecord[]> {
    const all = await this.listDocuments(userId);
    return all.filter((d) => d.applications?.some((a) => a.id === applicationId));
  }

  async listDocuments(userId: string | null): Promise<DocumentRecord[]> {
    let q: FirebaseFirestore.Query = this.docs.orderBy("uploadedAt", "desc");
    if (userId !== null) q = q.where("userId", "==", userId);
    const snap = await q.get();
    const documents = snap.docs.map((d) => {
      const rec = mapDoc(d.id, d.data());
      rec.applications = []; // populated below
      return rec;
    });

    // Batch-resolve application refs
    const allAppIds = new Set<string>();
    snap.docs.forEach((d) => {
      const ids: string[] = d.data().applicationIds ?? [];
      ids.forEach((id) => allAppIds.add(id));
    });

    if (allAppIds.size > 0) {
      const appMap = userId === null
        ? await this.loadAppRefs(Array.from(allAppIds))
        : await this.loadVerifiedAppRefs(Array.from(allAppIds), userId);
      for (let i = 0; i < documents.length; i++) {
        const ids: string[] = snap.docs[i].data().applicationIds ?? [];
        documents[i].applications = ids
          .map((id) => appMap.get(id))
          .filter((a): a is NonNullable<typeof a> => !!a);
      }
    }
    return documents;
  }

  async listDocumentsFiltered(
    userId: string | null,
    filter: ListDocumentsFilter,
  ): Promise<Partial<DocumentRecord>[]> {
    let documents = await this.listDocuments(userId);
    if (filter.applicationId) {
      documents = documents.filter((document) =>
        document.applications?.some((application) => application.id === filter.applicationId),
      );
    }
    if (filter.documentType) documents = documents.filter((document) => document.documentType === filter.documentType);
    if (filter.state) documents = documents.filter((document) => document.state === filter.state);
    if (filter.submissionId) documents = documents.filter((document) => document.submissionId === filter.submissionId);
    if (filter.excludeSubmissionArtifacts) {
      documents = documents.filter((document) =>
        !document.submissionId && document.state !== "submitted" && document.state !== "historical"
      );
    }
    if (filter.orphaned !== undefined) {
      documents = documents.filter((document) =>
        filter.orphaned ? !document.applications?.length : Boolean(document.applications?.length),
      );
    }
    const pageSize = Math.max(1, Math.min(200, filter.pageSize ?? filter.limit ?? 50));
    const page = Math.max(1, filter.page ?? 1);
    const pageDocuments = documents.slice((page - 1) * pageSize, page * pageSize);
    if (!filter.fields?.length) return pageDocuments;
    return pageDocuments.map((document) => {
      const selected: Partial<DocumentRecord> = { id: document.id };
      for (const field of filter.fields ?? []) {
        if (field in document) {
          (selected as Record<string, unknown>)[field] = document[field as keyof DocumentRecord];
        }
      }
      return selected;
    });
  }

  async getDocument(id: string, userId: string | null): Promise<DocumentRecord | null> {
    const document = await this.docs.doc(id).get();
    if (!document.exists) return null;
    const data = document.data()!;
    if (userId !== null && data.userId !== userId) return null;
    const record = mapDoc(id, data);
    const applicationIds: string[] = Array.isArray(data.applicationIds) ? data.applicationIds : [];
    const applicationMap = userId === null
      ? await this.loadAppRefs(applicationIds)
      : await this.loadVerifiedAppRefs(applicationIds, userId);
    record.applications = applicationIds
      .map((applicationId) => applicationMap.get(applicationId))
      .filter((application): application is NonNullable<typeof application> => Boolean(application));
    return record;
  }

  async updateDocumentMetadata(
    id: string,
    userId: string,
    data: UpdateDocumentMetadataInput,
    options?: DocumentMutationOptions,
  ): Promise<DocumentRecord> {
    const reference = this.docs.doc(id);
    const update: Record<string, unknown> = {};
    if (data.documentType !== undefined) update.documentType = data.documentType;
    if (data.state !== undefined) update.state = data.state;
    if (data.version !== undefined) update.version = data.version;
    if (data.contentHash !== undefined) update.contentHash = data.contentHash;
    if (data.source !== undefined) update.source = data.source;
    if (data.generatedAt !== undefined) update.generatedAt = toTimestamp(data.generatedAt);
    if (data.submittedAt !== undefined) update.submittedAt = toTimestamp(data.submittedAt);
    await this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference);
      if (!existing.exists || existing.data()!.userId !== userId) throw new Error("not_found");
      const currentApplicationIds = Array.isArray(existing.data()!.applicationIds)
        ? Array.from(new Set(existing.data()!.applicationIds as string[]))
        : [];
      if (options?.requireNonDemoProvenance) {
        const applications = await Promise.all(
          currentApplicationIds.map((applicationId) => transaction.get(this.apps.doc(applicationId))),
        );
        const hasConfirmedRealParent = applications.some((application) =>
          application.exists
          && application.data()!.userId === userId
          && application.data()!.isDemo !== true
          && application.data()!.deletionState !== "in_progress"
        );
        if ((existing.data()!.demoProvenance === true || currentApplicationIds.length > 0) && !hasConfirmedRealParent) {
          throw new Error("not_found");
        }
      }
      const submissionId = existing.data()!.submissionId;
      const keys = Object.keys(data);
      const stateOnly = keys.every((key) => key === "state");
      const immutable = submissionId || existing.data()!.state === "submitted" || existing.data()!.state === "historical";
      if (immutable) {
        const allowedState = data.state === existing.data()!.state
          || (existing.data()!.state === "submitted" && data.state === "historical");
        if (!stateOnly || !allowedState) {
          throw new Error("submitted_document_immutable");
        }
      } else if (data.state === "submitted") {
        throw new Error("submitted_state_reserved");
      }
      transaction.update(reference, update);
    });
    return (await this.getDocument(id, userId))!;
  }

  async createDocument(userId: string, data: CreateDocumentInput, options?: DocumentMutationOptions): Promise<DocumentRecord> {
    const { applicationIds, submissionId, ...rest } = data;
    if (submissionId || rest.state === "submitted") throw new Error("submitted_state_reserved");
    const uniqueApplicationIds = Array.from(new Set(applicationIds));
    const applicationReferences = uniqueApplicationIds.map((applicationId) => this.apps.doc(applicationId));
    const reference = this.docs.doc();
    const payload = {
      userId,
      ...rest,
      applicationIds: uniqueApplicationIds,
      uploadedAt: Timestamp.now(),
    };
    const creation = await this.db.runTransaction(async (transaction) => {
      const applicationSnapshots = await Promise.all(
        applicationReferences.map((applicationReference) => transaction.get(applicationReference)),
      );
      if (applicationSnapshots.some((snapshot) =>
        !snapshot.exists
        || snapshot.data()!.userId !== userId
        || snapshot.data()!.deletionState === "in_progress"
        || (options?.requireNonDemoProvenance && snapshot.data()!.isDemo === true)
      )) {
        throw new Error("invalid_applications");
      }
      const demoProvenance = applicationSnapshots.some((snapshot) => snapshot.data()!.isDemo === true);
      transaction.create(reference, { ...payload, demoProvenance });
      return {
        demoProvenance,
        applications: applicationSnapshots.map((snapshot) => ({
          id: snapshot.id,
          company: String(snapshot.data()!.company),
          role: String(snapshot.data()!.role),
        })),
      };
    });
    const record = mapDoc(reference.id, { ...payload, demoProvenance: creation.demoProvenance });
    record.applications = creation.applications;
    return record;
  }

  async updateDocumentLinks(id: string, userId: string, applicationIds: string[], options?: DocumentMutationOptions): Promise<DocumentRecord> {
    const reference = this.docs.doc(id);
    const uniqueApplicationIds = Array.from(new Set(applicationIds));
    const applicationReferences = uniqueApplicationIds.map((applicationId) => this.apps.doc(applicationId));
    await this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference);
      if (!existing.exists || existing.data()!.userId !== userId) throw new Error("not_found");
      const currentApplicationIds = Array.isArray(existing.data()!.applicationIds)
        ? Array.from(new Set(existing.data()!.applicationIds as string[]))
        : [];
      if (options?.requireNonDemoProvenance) {
        const currentApplications = await Promise.all(
          currentApplicationIds.map((applicationId) => transaction.get(this.apps.doc(applicationId))),
        );
        const hasConfirmedRealParent = currentApplications.some((application) =>
          application.exists
          && application.data()!.userId === userId
          && application.data()!.isDemo !== true
          && application.data()!.deletionState !== "in_progress"
        );
        if ((existing.data()!.demoProvenance === true || currentApplicationIds.length > 0) && !hasConfirmedRealParent) {
          throw new Error("not_found");
        }
      }
      if (
        existing.data()!.submissionId
        || existing.data()!.state === "submitted"
        || existing.data()!.state === "historical"
      ) throw new Error("submitted_document_immutable");
      const applicationSnapshots = await Promise.all(
        applicationReferences.map((applicationReference) => transaction.get(applicationReference)),
      );
      if (applicationSnapshots.some((snapshot) =>
        !snapshot.exists
        || snapshot.data()!.userId !== userId
        || snapshot.data()!.deletionState === "in_progress"
        || (options?.requireNonDemoProvenance && snapshot.data()!.isDemo === true)
      )) {
        throw new Error("invalid_applications");
      }
      transaction.update(reference, {
        applicationIds: uniqueApplicationIds,
        demoProvenance: existing.data()!.demoProvenance === true
          || applicationSnapshots.some((snapshot) => snapshot.data()!.isDemo === true),
      });
    });
    return (await this.getDocument(id, userId))!;
  }

  async renameDocument(id: string, userId: string, newName: string): Promise<DocumentRecord | null> {
    const reference = this.docs.doc(id);
    const changed = await this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference);
      if (!existing.exists || existing.data()!.userId !== userId) return false;
      if (
        existing.data()!.submissionId
        || existing.data()!.state === "submitted"
        || existing.data()!.state === "historical"
      ) throw new Error("submitted_document_immutable");
      transaction.update(reference, { originalName: newName });
      return true;
    });
    return changed ? this.getDocument(id, userId) : null;
  }

  async deleteDocument(id: string, userId: string, options?: DocumentMutationOptions): Promise<DocumentRecord | null> {
    const reference = this.docs.doc(id);
    const document = await this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference);
      if (!existing.exists || existing.data()!.userId !== userId) return null;
      const currentApplicationIds = Array.isArray(existing.data()!.applicationIds)
        ? Array.from(new Set(existing.data()!.applicationIds as string[]))
        : [];
      if (options?.requireNonDemoProvenance) {
        const applications = await Promise.all(
          currentApplicationIds.map((applicationId) => transaction.get(this.apps.doc(applicationId))),
        );
        const hasConfirmedRealParent = applications.some((application) =>
          application.exists
          && application.data()!.userId === userId
          && application.data()!.isDemo !== true
          && application.data()!.deletionState !== "in_progress"
        );
        if ((existing.data()!.demoProvenance === true || currentApplicationIds.length > 0) && !hasConfirmedRealParent) {
          throw new Error("not_found");
        }
      }
      if (
        existing.data()!.submissionId
        || existing.data()!.state === "submitted"
        || existing.data()!.state === "historical"
      ) throw new Error("submitted_document_immutable");
      const record = mapDoc(id, existing.data()!);
      transaction.delete(reference);
      return record;
    });
    if (!document) return null;
    await prisma.shareLink.deleteMany({ where: { userId, targetType: "document", targetId: id } });
    return document;
  }

  // ── Users ───────────────────────────────────────────────────────────────
  // Auth data lives in Prisma (PostgreSQL) for both backends.

  async getUser(id: string): Promise<UserRecord | null> {
    return prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, isAdmin: true },
    });
  }

  async listUsers(): Promise<UserRecord[]> {
    return prisma.user.findMany({
      orderBy: [{ isAdmin: "desc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, isAdmin: true },
    });
  }

  async updateUserAdmin(id: string, isAdmin: boolean): Promise<UserRecord> {
    return prisma.user.update({
      where: { id },
      data: { isAdmin },
      select: { id: true, name: true, email: true, isAdmin: true },
    });
  }

  // ── Audit Logs (stored in Prisma like users) ──────────────────────────

  async createAuditLog(actorId: string, action: string, targetId: string): Promise<void> {
    await prisma.adminAuditLog.create({
      data: { actorId, action, targetId },
    });
  }

  async listAuditLogs(limit = 50): Promise<AuditLogRecord[]> {
    const rows = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        actor: { select: { email: true } },
        target: { select: { email: true } },
      },
    });
    return rows.map((r) => ({
      id: String(r.id),
      actorId: r.actorId,
      actorEmail: r.actor.email,
      action: r.action,
      targetId: r.targetId,
      targetEmail: r.target.email,
      createdAt: r.createdAt,
    }));
  }

  // ── API Tokens (stored in Prisma like users) ──────────────────────────

  async getApiTokenByHash(tokenHash: string): Promise<ApiTokenRecord | null> {
    const row = await prisma.userApiToken.findUnique({ where: { tokenHash } });
    return row ? { ...row, id: String(row.id) } : null;
  }

  async getApiToken(userId: string): Promise<ApiTokenInfo | null> {
    const row = await prisma.userApiToken.findFirst({
      where: { userId },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
    return row ? { ...row, id: String(row.id) } : null;
  }

  async createApiToken(userId: string, tokenHash: string, name = "default"): Promise<ApiTokenInfo> {
    await prisma.userApiToken.deleteMany({ where: { userId } });
    const row = await prisma.userApiToken.create({
      data: { userId, tokenHash, name },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
    return { ...row, id: String(row.id) };
  }

  async deleteApiToken(userId: string): Promise<void> {
    await prisma.userApiToken.deleteMany({ where: { userId } });
  }

  async touchApiTokenLastUsed(id: string): Promise<void> {
    await prisma.userApiToken.update({
      where: { id: parseInt(id, 10) },
      data: { lastUsedAt: new Date() },
    });
  }

  // ── Share Links (stored in Prisma like users) ─────────────────────────

  async getShareLinkByCode(code: string): Promise<ShareLinkRecord | null> {
    const row = await prisma.shareLink.findUnique({ where: { code } });
    return row ? { ...row, id: String(row.id) } : null;
  }

  async listShareLinks(userId: string): Promise<ShareLinkRecord[]> {
    const rows = await prisma.shareLink.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({ ...row, id: String(row.id) }));
  }

  async findShareLink(userId: string, targetType: string, targetId: string | null): Promise<ShareLinkRecord | null> {
    const row = await prisma.shareLink.findFirst({
      where: { userId, targetType, targetId },
    });
    return row ? { ...row, id: String(row.id) } : null;
  }

  async createShareLink(userId: string, data: CreateShareLinkInput): Promise<ShareLinkRecord> {
    const row = await prisma.shareLink.create({
      data: { userId, ...data },
    });
    return { ...row, id: String(row.id) };
  }

  async deleteShareLink(id: string, userId: string): Promise<void> {
    await prisma.shareLink.delete({ where: { id: parseInt(id, 10), userId } });
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async loadContactsByAppIds(appIds: string[]): Promise<Map<string, ContactRecord[]>> {
    const map = new Map<string, ContactRecord[]>();
    // Firestore `in` queries support max 30 values; chunk if needed
    for (let i = 0; i < appIds.length; i += 30) {
      const chunk = appIds.slice(i, i + 30);
      const snap = await this.contacts.where("applicationId", "in", chunk).get();
      for (const doc of snap.docs) {
        const c = mapContact(doc.id, doc.data());
        const list = map.get(c.applicationId) ?? [];
        list.push(c);
        map.set(c.applicationId, list);
      }
    }
    return map;
  }

  private async loadAppRefs(ids: string[]): Promise<Map<string, { id: string; company: string; role: string }>> {
    const map = new Map<string, { id: string; company: string; role: string }>();
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const refs = chunk.map((id) => this.apps.doc(id));
      const snaps = await this.db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) {
          const d = snap.data()!;
          map.set(snap.id, { id: snap.id, company: d.company, role: d.role });
        }
      }
    }
    return map;
  }

  private async loadVerifiedAppRefs(
    ids: string[],
    userId: string,
  ): Promise<Map<string, { id: string; company: string; role: string }>> {
    const map = new Map<string, { id: string; company: string; role: string }>();
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const refs = chunk.map((id) => this.apps.doc(id));
      const snaps = await this.db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) {
          const d = snap.data()!;
          if (d.userId === userId) {
            map.set(snap.id, { id: snap.id, company: d.company, role: d.role });
          }
        }
      }
    }
    return map;
  }

  private async loadVerifiedEventParents(
    ids: string[],
    userId: string,
  ): Promise<Map<string, {
    data: FirebaseFirestore.DocumentData;
    summary: { id: string; company: string; role: string };
  }>> {
    const map = new Map<string, {
      data: FirebaseFirestore.DocumentData;
      summary: { id: string; company: string; role: string };
    }>();
    for (let i = 0; i < ids.length; i += 30) {
      const refs = ids.slice(i, i + 30).map((id) => this.apps.doc(id));
      const snapshots = await this.db.getAll(...refs);
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue;
        const data = snapshot.data()!;
        if (data.userId !== userId) continue;
        map.set(snapshot.id, {
          data,
          summary: { id: snapshot.id, company: data.company, role: data.role },
        });
      }
    }
    return map;
  }

  // CV profiles remain user-keyed in PostgreSQL; application-bound patches are
  // stored in Firestore so opaque IDs and owner relationships stay consistent.

  async getCvProfile(userId: string): Promise<CvProfileRecord | null> {
    const row = await prisma.cvProfile.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      id: String(row.id),
      userId: row.userId,
      name: row.name,
      contact: row.contact as unknown as CvProfileRecord["contact"],
      profile: row.profile,
      skills: row.skills as unknown as CvProfileRecord["skills"],
      experience: row.experience as unknown as CvProfileRecord["experience"],
      projects: row.projects as unknown as CvProfileRecord["projects"],
      education: row.education as unknown as CvProfileRecord["education"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async upsertCvProfile(userId: string, data: UpsertCvProfileInput): Promise<CvProfileRecord> {
    const payload = {
      name: data.name,
      contact: data.contact as unknown as import("@prisma/client").Prisma.InputJsonValue,
      profile: data.profile,
      skills: data.skills as unknown as import("@prisma/client").Prisma.InputJsonValue,
      experience: data.experience as unknown as import("@prisma/client").Prisma.InputJsonValue,
      projects: (data.projects ?? []) as unknown as import("@prisma/client").Prisma.InputJsonValue,
      education: (data.education ?? []) as unknown as import("@prisma/client").Prisma.InputJsonValue,
    };
    const row = await prisma.cvProfile.upsert({
      where: { userId },
      create: { userId, ...payload },
      update: payload,
    });
    return {
      id: String(row.id),
      userId: row.userId,
      name: row.name,
      contact: row.contact as unknown as CvProfileRecord["contact"],
      profile: row.profile,
      skills: row.skills as unknown as CvProfileRecord["skills"],
      experience: row.experience as unknown as CvProfileRecord["experience"],
      projects: row.projects as unknown as CvProfileRecord["projects"],
      education: row.education as unknown as CvProfileRecord["education"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getCvPatch(applicationId: string, userId: string): Promise<CvPatchRecord | null> {
    const snapshot = await getDb().collection("cvPatches").doc(applicationId).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data()!;
    if (data.userId !== userId || data.applicationId !== applicationId) return null;
    return {
      id: snapshot.id,
      applicationId: data.applicationId,
      profileOverride: data.profileOverride ?? null,
      experienceIds: Array.isArray(data.experienceIds) ? data.experienceIds : [],
      skillCategories: Array.isArray(data.skillCategories) ? data.skillCategories : [],
      includeProjects: data.includeProjects ?? false,
      includeEducation: data.includeEducation ?? true,
      documentId: data.documentId ?? null,
      createdAt: toDate(data.createdAt) ?? new Date(),
      updatedAt: toDate(data.updatedAt) ?? new Date(),
    };
  }

  async upsertCvPatch(applicationId: string, userId: string, data: UpsertCvPatchInput): Promise<CvPatchRecord> {
    const db = getDb();
    const applicationRef = db.collection("applications").doc(applicationId);
    const patchRef = db.collection("cvPatches").doc(applicationId);
    await db.runTransaction(async (transaction) => {
      const [applicationSnapshot, patchSnapshot] = await Promise.all([
        transaction.get(applicationRef),
        transaction.get(patchRef),
      ]);
      if (!applicationSnapshot.exists || applicationSnapshot.data()?.userId !== userId) {
        throw new Error("not_found");
      }
      const current = patchSnapshot.exists ? patchSnapshot.data()! : null;
      const now = Timestamp.now();
      transaction.set(patchRef, {
        applicationId,
        userId,
        profileOverride: data.profileOverride ?? null,
        experienceIds: data.experienceIds,
        skillCategories: data.skillCategories,
        includeProjects: data.includeProjects ?? false,
        includeEducation: data.includeEducation ?? true,
        documentId: current?.documentId ?? null,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      });
    });
    const patch = await this.getCvPatch(applicationId, userId);
    if (!patch) throw new Error("not_found");
    return patch;
  }

  async setCvPatchDocumentId(patchId: string, userId: string, documentId: string | null): Promise<void> {
    const db = getDb();
    const patchRef = db.collection("cvPatches").doc(patchId);
    await db.runTransaction(async (transaction) => {
      const patchSnapshot = await transaction.get(patchRef);
      if (!patchSnapshot.exists || patchSnapshot.data()?.userId !== userId) {
        throw new Error("not_found");
      }
      if (documentId) {
        const documentSnapshot = await transaction.get(db.collection("documents").doc(documentId));
        if (!documentSnapshot.exists || documentSnapshot.data()?.userId !== userId) {
          throw new Error("not_found");
        }
      }
      transaction.update(patchRef, { documentId, updatedAt: Timestamp.now() });
    });
  }

  // ── Career Ops (Hermes session bridge) ───────────────────────────────────

  private mapCareerOpsThread(id: string, data: FirebaseFirestore.DocumentData): CareerOpsThreadRecord {
    return {
      id,
      userId: data.userId,
      hermesSessionId: data.hermesSessionId,
      title: data.title,
      applicationId: typeof data.applicationId === "string" ? data.applicationId : null,
      createdAt: toDate(data.createdAt) ?? new Date(0),
      updatedAt: toDate(data.updatedAt) ?? new Date(0),
    };
  }

  private mapCareerOpsRun(id: string, data: FirebaseFirestore.DocumentData): CareerOpsRunRecord {
    return {
      id,
      userId: data.userId,
      threadId: data.threadId,
      hermesRunId: data.hermesRunId,
      clientRequestId: data.clientRequestId,
      status: data.status as CareerOpsRunStatus,
      approvalChoice: typeof data.approvalChoice === "string" ? data.approvalChoice : null,
      approvalAt: toDate(data.approvalAt),
      approvalChallengeId:
        typeof data.approvalChallengeId === "string" ? data.approvalChallengeId : null,
      approvalState:
        typeof data.approvalState === "string"
          ? (data.approvalState as CareerOpsApprovalState)
          : null,
      approvalGateOpenedAt: toDate(data.approvalGateOpenedAt),
      requestHash: typeof data.requestHash === "string" ? data.requestHash : "",
      pendingApprovalChallengeId:
        typeof data.pendingApprovalChallengeId === "string"
          ? data.pendingApprovalChallengeId
          : null,
      createdAt: toDate(data.createdAt) ?? new Date(0),
      updatedAt: toDate(data.updatedAt) ?? new Date(0),
    };
  }

  /**
   * Deterministic run document id.
   *
   * Firestore has no unique index, so uniqueness on
   * (threadId, clientRequestId) is expressed as the document key and enforced
   * by create(), which fails when the document already exists. That gives the
   * same "exactly one run per client request" guarantee as the Prisma
   * composite unique constraint.
   */
  private careerOpsRunRef(threadId: string, clientRequestId: string) {
    return this.careerOpsRuns.doc(
      submissionRequestHash({ kind: "career-ops-run", threadId, clientRequestId }),
    );
  }

  async listCareerOpsThreads(userId: string): Promise<CareerOpsThreadRecord[]> {
    // Finish any run-document cleanup an earlier deletion could not complete.
    //
    // Doing this only on the next deletion made recovery depend on the user
    // happening to delete another conversation: if they never did, the
    // tombstone and its run documents persisted indefinitely despite being
    // recorded. Listing is the operation that actually recurs — the drawer runs
    // it every time it opens — so the work resumes on its own. It is bounded to
    // one tombstone here because this is a user-facing read, and it never fails
    // the listing.
    await this.resumeCareerOpsThreadDeletions(userId, 1);
    const snapshot = await this.careerOpsThreads
      .where("userId", "==", userId)
      .orderBy("updatedAt", "desc")
      .get();
    const threads = snapshot.docs.map((document) =>
      this.mapCareerOpsThread(document.id, document.data()),
    );
    // Deterministic tiebreak so equal timestamps never reorder between reads.
    threads.sort((left, right) => {
      const byUpdated = right.updatedAt.getTime() - left.updatedAt.getTime();
      if (byUpdated !== 0) return byUpdated;
      return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
    });
    return threads;
  }

  async getCareerOpsThread(id: string, userId: string): Promise<CareerOpsThreadRecord | null> {
    const snapshot = await this.careerOpsThreads.doc(id).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data()!;
    if (data.userId !== userId) return null;
    return this.mapCareerOpsThread(snapshot.id, data);
  }

  async createCareerOpsThread(
    userId: string,
    data: CreateCareerOpsThreadInput,
  ): Promise<CareerOpsThreadRecord> {
    // Deterministic id from (owner, session), mirroring the relational
    // @@unique([userId, hermesSessionId]). With a random id the same Hermes
    // session could acquire two Nexus mappings, each with its own active-run
    // slot, and both could drive one upstream conversation at once.
    const ref = this.careerOpsThreads.doc(
      submissionRequestHash({ kind: "career-ops-thread", userId, session: data.hermesSessionId }),
    );
    const applicationId = data.applicationId ?? null;

    return this.db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        const current = existing.data()!;
        if (current.userId !== userId) throw new Error("career_ops_thread_conflict");
        return this.mapCareerOpsThread(existing.id, current);
      }

      // The application was verified before Hermes was asked for a session, and
      // it can be deleted during that round-trip. Re-read it inside the
      // transaction so a thread is never written against a record that is gone
      // — the relational backend gets this from its foreign key.
      if (applicationId) {
        const application = await tx.get(this.apps.doc(applicationId));
        if (!application.exists || application.data()!.userId !== userId) {
          throw new Error("career_ops_application_not_found");
        }
        // Deletion marks the application before it clears Career Ops links, so
        // a thread written after that sweep but before the final delete would
        // keep a dangling id and fail context lookup forever. The other
        // Firestore application mutations reject the marker for the same
        // reason.
        if (application.data()!.deletionState === "in_progress") {
          throw new Error("career_ops_application_not_found");
        }
      }

      const now = Timestamp.now();
      const payload = {
        userId,
        hermesSessionId: data.hermesSessionId,
        title: data.title,
        applicationId,
        createdAt: now,
        updatedAt: now,
      };
      tx.create(ref, payload);
      return this.mapCareerOpsThread(ref.id, payload);
    });
  }

  async renameCareerOpsThread(
    id: string,
    userId: string,
    title: string,
  ): Promise<CareerOpsThreadRecord | null> {
    const ref = this.careerOpsThreads.doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data()!.userId !== userId) return null;
    await ref.update({ title, updatedAt: Timestamp.now() });
    return this.getCareerOpsThread(id, userId);
  }

  async deleteCareerOpsThread(id: string, userId: string): Promise<CareerOpsThreadDeletion> {
    // Finish what an earlier request could not, before starting more. Doing it
    // first rather than last matters: retrying a cleanup in the same request
    // that just watched it fail retries it under the conditions that made it
    // fail, and would mask the interruption instead of recording it.
    await this.resumeCareerOpsThreadDeletions(userId, 3);
    const threadRef = this.careerOpsThreads.doc(id);
    // The refusal and the removal of the parent happen in one transaction, so a
    // submission cannot claim the conversation in a window between them and be
    // left with a privileged run nothing can address. The run documents are
    // cleaned up afterwards: once the parent is gone they resolve to nothing
    // (ownership is always checked through the thread), and Firestore caps a
    // transaction's writes, which a long conversation would exceed.
    const result = await this.db.runTransaction<CareerOpsThreadDeletion>(async (tx) => {
      const snapshot = await tx.get(threadRef);
      if (!snapshot.exists || snapshot.data()!.userId !== userId) {
        return { outcome: "not_found" };
      }
      const active = await tx.get(
        this.careerOpsRuns
          .where("threadId", "==", id)
          .where("status", "in", [...CAREER_OPS_ACTIVE_RUN_STATUSES]),
      );
      if (!active.empty) return { outcome: "active_run" };
      const thread = this.mapCareerOpsThread(snapshot.id, snapshot.data()!);
      tx.delete(threadRef);
      // Committed with the parent's removal, so the work is recorded before it
      // can be interrupted. There is no moment where the thread is gone and
      // nothing says its runs still need collecting.
      tx.set(this.careerOpsThreadDeletions.doc(id), {
        threadId: id,
        userId,
        deletedAt: Timestamp.now(),
      });
      return { outcome: "deleted", thread };
    });

    if (result.outcome !== "deleted") return result;

    // Failures here must not propagate. The authoritative mapping — the parent
    // thread — is already gone, so throwing would stop the caller from deleting
    // the upstream Hermes session while a retry could only ever see
    // `not_found`, losing the session id for good. Orphaned run documents are
    // inert in the meantime, because ownership always resolves through the
    // thread; the tombstone is what makes them collectable rather than
    // permanent.
    await this.collectCareerOpsThreadRuns(id, userId);
    return result;
  }

  /**
   * Delete a deleted conversation's run documents, then its tombstone.
   *
   * Ordered that way deliberately: the tombstone is removed only once nothing
   * is left to collect, so an interruption at any point leaves the work
   * described rather than lost. Re-running it is harmless.
   */
  private async collectCareerOpsThreadRuns(id: string, userId: string): Promise<boolean> {
    try {
      for (;;) {
        // Chunked, and re-queried each round: a long-lived conversation exceeds
        // the 500-write batch cap, and paging by offset over a snapshot taken
        // once would re-read documents this loop has already removed.
        const runs = await this.careerOpsRuns
          .where("threadId", "==", id)
          .where("userId", "==", userId)
          .limit(450)
          .get();
        if (runs.empty) break;
        const batch = this.db.batch();
        for (const document of runs.docs) batch.delete(document.ref);
        await batch.commit();
        if (runs.docs.length < 450) break;
      }
      await this.careerOpsThreadDeletions.doc(id).delete();
      return true;
    } catch {
      // The tombstone stays, so this is retried rather than forgotten.
      return false;
    }
  }

  /** Finish deletions an earlier request could not complete. */
  private async resumeCareerOpsThreadDeletions(userId: string, limit: number): Promise<void> {
    try {
      const pending = await this.careerOpsThreadDeletions
        .where("userId", "==", userId)
        .limit(limit)
        .get();
      for (const document of pending.docs) {
        const data = document.data();
        if (data.userId !== userId) continue;
        await this.collectCareerOpsThreadRuns(document.id, userId);
      }
    } catch {
      // Best effort: the tombstones survive for the next attempt.
    }
  }

  async getCareerOpsRun(id: string, userId: string): Promise<CareerOpsRunRecord | null> {
    const snapshot = await this.careerOpsRuns.doc(id).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data()!;
    if (data.userId !== userId) return null;
    return this.mapCareerOpsRun(snapshot.id, data);
  }

  async claimCareerOpsRun(
    userId: string,
    data: CreateCareerOpsRunInput,
  ): Promise<CareerOpsRunClaim> {
    const ref = this.careerOpsRunRef(data.threadId, data.clientRequestId);
    const threadRef = this.careerOpsThreads.doc(data.threadId);
    // Firestore has no partial unique index, so the invariant Postgres gets
    // from one is enforced here by doing every read and the write inside one
    // transaction. Reading the parent thread in the same transaction is what
    // stops a concurrent thread deletion from leaving a live run behind with
    // no mapping to observe or stop it.
    return this.db.runTransaction<CareerOpsRunClaim>(async (tx) => {
      const thread = await tx.get(threadRef);
      if (!thread.exists || thread.data()!.userId !== userId) {
        return { outcome: "thread_gone" };
      }

      const mine = await tx.get(ref);
      if (mine.exists) {
        const current = mine.data()!;
        if (current.userId !== userId) return { outcome: "thread_gone" };
        // A retry must carry the same message. `""` marks a row written before
        // the digest existed, and is accepted so a mid-flight deploy cannot
        // start refusing legitimate retries.
        if (
          typeof current.requestHash === "string" &&
          current.requestHash !== "" &&
          current.requestHash !== data.requestHash
        ) {
          return { outcome: "request_mismatch" };
        }
        return { outcome: "existing", run: this.mapCareerOpsRun(mine.id, current) };
      }

      const active = await tx.get(
        this.careerOpsRuns
          .where("threadId", "==", data.threadId)
          .where("status", "in", [...CAREER_OPS_ACTIVE_RUN_STATUSES]),
      );
      if (!active.empty) return { outcome: "active_run_exists" };

      const now = Timestamp.now();
      const payload = {
        userId,
        threadId: data.threadId,
        hermesRunId: data.hermesRunId,
        clientRequestId: data.clientRequestId,
        requestHash: data.requestHash,
        status: data.status,
        createdAt: now,
        updatedAt: now,
      };
      tx.create(ref, payload);
      // Same ordering rule as the relational backend: activity, not creation
      // time, decides where a conversation sits in history.
      tx.update(threadRef, { updatedAt: now });
      return { outcome: "claimed", run: this.mapCareerOpsRun(ref.id, payload) };
    });
  }

  async updateCareerOpsRunStatus(
    id: string,
    userId: string,
    status: CareerOpsRunStatus,
  ): Promise<void> {
    const ref = this.careerOpsRuns.doc(id);
    const terminal = (CAREER_OPS_TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
    // Same monotonicity rule as the relational backend, and for the same
    // reason: a late poll must not move a settled run back to active. Read and
    // write in one transaction so the check cannot be raced.
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.data()!.userId !== userId) return;
      const current = snapshot.data()!.status as string;
      const currentIsTerminal = (CAREER_OPS_TERMINAL_RUN_STATUSES as readonly string[]).includes(
        current,
      );
      // Monotonic, and terminal states are final. A late `failed` landing on a
      // `completed` run rewrites what the agent actually did, and the audit
      // beside it. Re-writing the same terminal status stays a no-op rather
      // than an error, so a duplicate delivery is harmless.
      if (currentIsTerminal && current !== status) return;
      tx.update(ref, {
        status,
        updatedAt: Timestamp.now(),
        // A terminal run has no gate. Leaving one open lets a delayed or direct
        // denial claim it long after the run finished: the decision would
        // overwrite the terminal run's approval audit and be forwarded upstream
        // for an action nobody is waiting on.
        ...(terminal ? { approvalGateOpenedAt: null, pendingApprovalChallengeId: null } : {}),
      });
    });
  }

  async bindCareerOpsRunHermesId(
    id: string,
    userId: string,
    hermesRunId: string,
  ): Promise<CareerOpsRunRecord | null> {
    const ref = this.careerOpsRuns.doc(id);
    return this.db.runTransaction<CareerOpsRunRecord | null>(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return null;
      const data = snapshot.data()!;
      if (data.userId !== userId) return null;
      // Conditional: expiry can reach this row, and only one of the two may win.
      if (data.hermesRunId !== "") return null;
      if (!CAREER_OPS_ACTIVE_RUN_STATUSES.includes(data.status)) return null;
      tx.update(ref, { hermesRunId, updatedAt: Timestamp.now() });
      return this.mapCareerOpsRun(snapshot.id, { ...data, hermesRunId });
    });
  }

  async expireCareerOpsRunReservation(
    id: string,
    userId: string,
    cutoff: Date,
  ): Promise<boolean> {
    const ref = this.careerOpsRuns.doc(id);
    return this.db.runTransaction<boolean>(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return false;
      const data = snapshot.data()!;
      if (data.userId !== userId) return false;
      if (data.hermesRunId !== "") return false;
      if (!CAREER_OPS_ACTIVE_RUN_STATUSES.includes(data.status)) return false;
      // Same conversion the rest of this adapter uses; an `instanceof` check
      // here is narrower than the values Firestore actually returns.
      const createdAt = toDate(data.createdAt);
      if (!createdAt || createdAt.getTime() >= cutoff.getTime()) return false;
      // Not `failed`: Nexus never saw this run end and cannot say that it did.
      tx.update(ref, { status: "abandoned", updatedAt: Timestamp.now() });
      return true;
    });
  }

  async deleteCareerOpsRun(id: string, userId: string): Promise<void> {
    const ref = this.careerOpsRuns.doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data()!.userId !== userId) return;
    await ref.delete();
  }

  async openCareerOpsApprovalGate(
    id: string,
    userId: string,
    challengeId: string | null,
  ): Promise<boolean> {
    const ref = this.careerOpsRuns.doc(id);
    // One transaction, because the check and the write are a single decision.
    // Read the status, then write outside it, and the poll that records a
    // terminal status can commit in between: the run settles, its terminal
    // write clears the gate, and this write puts the gate back on a finished
    // run for a stale denial to claim. The relational backend expresses the
    // same thing as one conditional update.
    // The result says whether the guarded write happened, not merely that
    // nothing threw: disclosing controls for a gate that was never opened
    // leaves the user clicking buttons that can only conflict.
    return this.db.runTransaction<boolean>(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.data()!.userId !== userId) return false;
      // Never on a finished run.
      if (
        (CAREER_OPS_TERMINAL_RUN_STATUSES as readonly string[]).includes(snapshot.data()!.status)
      ) {
        return false;
      }
      // The gate lives here, not in `status`: recovery and the event route both
      // write status, and either would otherwise reopen a claimed gate.
      tx.update(ref, {
        approvalGateOpenedAt: Timestamp.now(),
        pendingApprovalChallengeId: challengeId,
      });
      return true;
    });
  }

  async claimCareerOpsApprovalGate(
    id: string,
    userId: string,
    challengeId: string | null,
  ): Promise<CareerOpsApprovalGateClaim | null> {
    const ref = this.careerOpsRuns.doc(id);
    return this.db.runTransaction<CareerOpsApprovalGateClaim | null>(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return null;
      const data = snapshot.data()!;
      if (data.userId !== userId) return null;
      // The gate is its own state, not the challenge and not the run status: a
      // prompt whose challenge never landed is still a gate a human may deny,
      // and a status snapshot from recovery must never reopen a claimed one.
      if (!data.approvalGateOpenedAt) return null;
      const outstanding =
        typeof data.pendingApprovalChallengeId === "string"
          ? data.pendingApprovalChallengeId
          : "";
      // A grant must answer the gate that is actually pending.
      if (challengeId !== null && outstanding !== challengeId) return null;
      // The transaction decides: a concurrent claim writing this document makes
      // the loser re-run and find the gate already closed.
      tx.update(ref, {
        approvalGateOpenedAt: null,
        pendingApprovalChallengeId: null,
        updatedAt: Timestamp.now(),
      });
      return { challengeId: outstanding };
    });
  }

  async recoverCareerOpsApprovalGate(id: string, userId: string): Promise<boolean> {
    const ref = this.careerOpsRuns.doc(id);
    return this.db.runTransaction<boolean>(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return false;
      const data = snapshot.data()!;
      if (data.userId !== userId) return false;
      // Never on a finished run, and never while one is already open.
      if ((CAREER_OPS_TERMINAL_RUN_STATUSES as readonly string[]).includes(data.status)) {
        return false;
      }
      if (data.approvalGateOpenedAt) return false;
      // Never while a decision is unresolved: `pending` means one is in flight
      // and `outcome_unknown` means one may already have landed, so opening a
      // gate would let a second decision answer the first's action.
      if (data.approvalState === "pending" || data.approvalState === "outcome_unknown") {
        return false;
      }
      // No challenge: nothing was disclosed, so nothing may be granted.
      tx.update(ref, {
        approvalGateOpenedAt: Timestamp.now(),
        pendingApprovalChallengeId: null,
        updatedAt: Timestamp.now(),
      });
      return true;
    });
  }

  async releaseCareerOpsApprovalGate(
    id: string,
    userId: string,
    challengeId: string,
  ): Promise<void> {
    const ref = this.careerOpsRuns.doc(id);
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return;
      const data = snapshot.data()!;
      if (data.userId !== userId) return;
      // Only if the gate is still exactly as the claim left it: closed with
      // nothing outstanding. A gate the agent has since reached is not this
      // caller's to reopen.
      if (data.approvalGateOpenedAt) return;
      if (data.pendingApprovalChallengeId) return;
      // And never on a settled run. A terminal transition clears the gate, so
      // its fields look exactly like the ones this claim left behind; without
      // this check a rollback would reinstate a gate on a finished run, where a
      // delayed denial can still claim it, be forwarded upstream for an action
      // nobody is waiting on, and overwrite that run's approval audit.
      if ((CAREER_OPS_TERMINAL_RUN_STATUSES as readonly string[]).includes(data.status)) return;
      tx.update(ref, {
        approvalGateOpenedAt: Timestamp.now(),
        pendingApprovalChallengeId: challengeId || null,
        updatedAt: Timestamp.now(),
      });
    });
  }

  async recordCareerOpsApprovalDecision(
    id: string,
    userId: string,
    choice: string,
    challengeId: string,
    state: CareerOpsApprovalState,
  ): Promise<void> {
    const ref = this.careerOpsRuns.doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data()!.userId !== userId) return;
    await ref.update({
      approvalChoice: choice,
      approvalAt: Timestamp.now(),
      approvalChallengeId: challengeId,
      approvalState: state,
    });
  }

  async findCareerOpsRunByClientRequestId(
    threadId: string,
    userId: string,
    clientRequestId: string,
  ): Promise<CareerOpsRunRecord | null> {
    // The deterministic id that enforces uniqueness also makes this a direct get.
    const snapshot = await this.careerOpsRunRef(threadId, clientRequestId).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data()!;
    if (data.userId !== userId) return null;
    return this.mapCareerOpsRun(snapshot.id, data);
  }

  async getLatestCareerOpsRun(
    threadId: string,
    userId: string,
  ): Promise<CareerOpsRunRecord | null> {
    // Ask the backend for the one row this needs. Reading every historical run
    // of a conversation and sorting in memory made each drawer open cost reads
    // and latency proportional to the conversation's whole lifetime.
    //
    // The `threadId ASC, userId ASC, createdAt DESC` index already declared for
    // this collection serves it. Firestore appends an implicit `__name__` tie
    // break in the direction of the last `orderBy`, so descending `createdAt`
    // gives the same deterministic winner as the relational backend's
    // `[{ createdAt: "desc" }, { id: "desc" }]`.
    const snapshot = await this.careerOpsRuns
      .where("threadId", "==", threadId)
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();
    const document = snapshot.docs[0];
    return document ? this.mapCareerOpsRun(document.id, document.data()) : null;
  }

  /**
   * Detach Career Ops conversations from an application that is going away.
   * The conversation survives as a global thread; the link is advisory context,
   * not ownership, so it must not cascade into a delete.
   */
  private async clearCareerOpsApplicationLinks(applicationId: string, userId: string): Promise<void> {
    const snapshot = await this.careerOpsThreads
      .where("userId", "==", userId)
      .where("applicationId", "==", applicationId)
      .get();
    if (snapshot.empty) return;
    // Same 500-write batch cap as the thread cascade: an application linked to
    // many conversations would otherwise become undeletable.
    for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
      const batch = this.db.batch();
      for (const document of snapshot.docs.slice(offset, offset + 450)) {
        batch.update(document.ref, { applicationId: null, updatedAt: Timestamp.now() });
      }
      await batch.commit();
    }
  }
}
