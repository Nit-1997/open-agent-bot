import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, link } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACT_ID_RE } from "@oab/shared/artifacts";
import { isUuid } from "@oab/shared/ids";
import { UserError } from "../../lib/errors.js";
import { log } from "../../lib/log.js";
import type { ArtifactFile, ArtifactStorage } from "../../store/types.js";

const FILES: readonly ArtifactFile[] = ["html", "pdf", "jpg"];

export const missingReport = () => new UserError("That report doesn't exist.", "not_found");

export function validArtifactId(id: string): string {
  if (typeof id !== "string" || !ARTIFACT_ID_RE.test(id)) throw missingReport();
  return id;
}

export function reportPath(reportsDir: string, userId: string, id: string, file: ArtifactFile): string {
  if (!isUuid(userId) || userId !== userId.toLowerCase()) throw new Error("reportPath needs a verified user id");
  if (!FILES.includes(file)) throw missingReport();
  return join(reportsDir, userId, `${validArtifactId(id)}.${file}`);
}

const codeOf = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code;

const failed = (where: string, e: unknown) => {
  log.error(`[files] ${where} failed code=${codeOf(e) ?? "unknown"}`);
  return new UserError("The data service returned an error.", "upstream");
};

async function fsyncDir(dir: string): Promise<void> {
  const fd = await open(dir, "r");
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}

async function writeTemp(dir: string, bytes: Buffer): Promise<string> {
  const temp = join(dir, `.upload-${randomBytes(8).toString("hex")}.tmp`);
  const fd = await open(temp, "wx", 0o600);
  try {
    await fd.writeFile(bytes);
    await fd.sync();
  } catch (e) {
    await fd.close();
    await rm(temp, { force: true });
    throw e;
  }
  await fd.close();
  return temp;
}

export function reportFiles(reportsDir: string, userId: string): ArtifactStorage {
  const userDir = join(reportsDir, userId);
  const ensureDir = async () => {
    await mkdir(reportsDir, { recursive: true, mode: 0o700 });
    await mkdir(userDir, { recursive: true, mode: 0o700 });
  };
  return {
    async upload(id, file, bytes) {
      const target = reportPath(reportsDir, userId, id, file);
      let temp: string | undefined;
      try {
        await ensureDir();
        temp = await writeTemp(userDir, bytes);
        if (file === "html") await link(temp, target);
        else {
          await rename(temp, target);
          temp = undefined;
        }
        await fsyncDir(userDir);
      } catch (e) {
        if (codeOf(e) === "EEXIST") throw new UserError("The data service returned an error.", "upstream");
        throw failed("upload", e);
      } finally {
        if (temp) await rm(temp, { force: true });
      }
    },
    async download(id, file) {
      const target = reportPath(reportsDir, userId, id, file);
      try {
        return await readFile(target);
      } catch (e) {
        if (codeOf(e) === "ENOENT" || codeOf(e) === "ENOTDIR") return undefined;
        throw failed("download", e);
      }
    },
    async remove(id, file) {
      const target = reportPath(reportsDir, userId, id, file);
      try {
        await rm(target, { force: true });
      } catch (e) {
        throw failed("remove", e);
      }
    },
  };
}
