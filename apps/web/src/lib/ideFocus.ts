/**
 * Returns true when the user's keyboard focus is inside the IDE panel (editor
 * buffers, conflict banners, approval cards). Gates `ide.save` so mod+s saves
 * the focused buffer instead of stashing the composer draft.
 */
export function isIdeFocused(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  if (!activeElement.isConnected) return false;
  return activeElement.closest("[data-ide-panel]") !== null;
}
