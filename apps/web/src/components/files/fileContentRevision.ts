import { fileContentRevision } from "@t3tools/shared/fileRevision";

export { fileContentRevision };

export function projectFileCacheKey(cwd: string, relativePath: string, contents: string): string {
  return `${cwd}:${relativePath}:${fileContentRevision(contents)}`;
}
