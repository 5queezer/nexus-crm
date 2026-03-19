import { FirestoreAdapter } from "../firestore-adapter";
import { CreateDocumentInput } from "../types";

// Mocking Firebase Admin
const mockGet = jest.fn();
const mockGetAll = jest.fn();
const mockAdd = jest.fn();
const mockUpdate = jest.fn();

let getCount = 0;
let getAllCount = 0;

const mockDoc = (id: string) => ({
  id,
  get: async () => {
    getCount++;
    return mockGet(id);
  },
  update: async (data: any) => mockUpdate(id, data),
});

const mockCollection = (name: string) => ({
  doc: (id: string) => mockDoc(id),
  add: async (data: any) => {
    const id = "new-doc-id";
    mockAdd(data);
    return {
      id,
      get: async () => {
        getCount++;
        return {
          exists: true,
          id,
          data: () => data,
        };
      },
    };
  },
  orderBy: () => ({
    where: () => ({
      get: async () => ({ docs: [] }),
    }),
    get: async () => ({ docs: [] }),
  }),
});

const mockDb = {
  collection: (name: string) => mockCollection(name),
  getAll: async (...refs: any[]) => {
    getAllCount++;
    return Promise.all(refs.map((ref) => ref.get()));
  },
  batch: () => ({
    delete: jest.fn(),
    commit: async () => {},
  }),
};

// Override getDb to return our mock
(global as any).getDb = () => mockDb;

// We need to mock firebase-admin/firestore and firebase-admin/app
// Since we are running with tsx, we might need a different approach if they are imported at top level.
// In firestore-adapter.ts:
// import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
// import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";

// Let's use a more direct approach by mocking the modules if possible,
// but since I'm just running a script, I might just monkey-patch or use a simpler mock.

async function runBenchmark() {
  const adapter = new FirestoreAdapter();

  // Reset counters
  getCount = 0;
  getAllCount = 0;

  const userId = "user-123";
  const applicationIds = ["app-1", "app-2", "app-3", "app-4", "app-5"];

  // Setup mock data for applications
  mockGet.mockImplementation((id: string) => {
    if (applicationIds.includes(id)) {
      return {
        exists: true,
        id,
        data: () => ({ userId, company: `Company ${id}`, role: "Developer" }),
      };
    }
    return { exists: false };
  });

  console.log(`--- Baseline Benchmark ---`);
  console.log(`Scenario: Creating a document linked to ${applicationIds.length} applications`);

  const input: CreateDocumentInput = {
    filename: "test.pdf",
    originalName: "test.pdf",
    size: 1024,
    mimeType: "application/pdf",
    applicationIds,
  };

  await adapter.createDocument(userId, input);

  console.log(`Firestore get() calls: ${getCount}`);
  console.log(`Firestore getAll() calls: ${getAllCount}`);
  console.log(`Total calls: ${getCount + getAllCount}`);
}

// Minimal jest.fn() replacement
function jest_fn(impl?: (...args: any[]) => any) {
  const fn = (...args: any[]) => {
    fn.mock.calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.mock = { calls: [] as any[][] };
  fn.mockImplementation = (newImpl: (...args: any[]) => any) => {
    impl = newImpl;
  };
  return fn;
}
const jest = { fn: jest_fn };

runBenchmark().catch(console.error);
