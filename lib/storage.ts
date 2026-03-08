import { Storage } from "@google-cloud/storage";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const useGCS = !!process.env.GCS_BUCKET;

let storage: Storage;
function getStorage() {
  if (!storage) storage = new Storage();
  return storage;
}

function getLocalDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
}

export async function uploadFile(
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  if (useGCS) {
    const file = getStorage().bucket(process.env.GCS_BUCKET!).file(filename);
    await file.save(buffer, { contentType });
  } else {
    const dir = getLocalDir();
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), buffer);
  }
}

export async function downloadFile(filename: string): Promise<Buffer> {
  if (useGCS) {
    const file = getStorage().bucket(process.env.GCS_BUCKET!).file(filename);
    const [contents] = await file.download();
    return Buffer.from(contents);
  } else {
    return readFile(path.join(getLocalDir(), filename));
  }
}

export async function deleteFile(filename: string): Promise<void> {
  if (useGCS) {
    const file = getStorage().bucket(process.env.GCS_BUCKET!).file(filename);
    await file.delete({ ignoreNotFound: true });
  } else {
    try {
      await unlink(path.join(getLocalDir(), filename));
    } catch {
      // file might already be gone
    }
  }
}

export function fileExists(filename: string): Promise<boolean> {
  if (useGCS) {
    const file = getStorage().bucket(process.env.GCS_BUCKET!).file(filename);
    return file.exists().then(([exists]) => exists);
  } else {
    return Promise.resolve(existsSync(path.join(getLocalDir(), filename)));
  }
}
