/**
 * The global `ide.save` keybinding is dispatched from ChatView, far above the
 * panel; the active buffer registers its flush here so the shortcut can reach
 * it without threading a ref through the panel tree. One entry per thread —
 * only the visible buffer registers.
 */
const flushByThreadKey = new Map<string, () => void>();

export function registerIdeSaveFlush(threadKey: string, flush: () => void): () => void {
  flushByThreadKey.set(threadKey, flush);
  return () => {
    if (flushByThreadKey.get(threadKey) === flush) {
      flushByThreadKey.delete(threadKey);
    }
  };
}

export function flushIdeSave(threadKey: string): boolean {
  const flush = flushByThreadKey.get(threadKey);
  if (flush === undefined) return false;
  flush();
  return true;
}
