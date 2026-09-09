/**
 * Content-identity hash shared by the web editor and the server's
 * conflict-checked writes. FNV-1a over UTF-16 code units, prefixed with the
 * length so equal-length collisions stay distinguishable by size. Not
 * cryptographic — it exists to detect "the file changed since you read it",
 * not to authenticate content.
 */
export function fileContentRevision(contents: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < contents.length; index += 1) {
    hash ^= contents.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${contents.length}:${(hash >>> 0).toString(36)}`;
}
