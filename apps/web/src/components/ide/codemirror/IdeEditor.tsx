import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";

import { ideLanguageForPath, loadIdeLanguage } from "./language";
import { ideBaseExtensions } from "./setup";
import { ideEditorChrome, loadIdeSyntaxHighlighting } from "./theme";

export interface IdeEditorProps {
  /**
   * Identity of the buffer (environment + cwd + path). A change rebuilds the
   * view — buffers do not share editor state.
   */
  readonly bufferKey: string;
  readonly path: string;
  readonly initialContents: string;
  readonly readOnly: boolean;
  /**
   * Contents to show when they differ from the current document. Drives
   * server-side reloads (agent edits) into the view; user typing never flows
   * back through this prop.
   */
  readonly contents: string;
  /** Fires on user-originated document changes only, never on `contents`. */
  readonly onUserEdit: (contents: string) => void;
  readonly onFocusChange?: (focused: boolean) => void;
}

/**
 * Imperative CodeMirror host. React Compiler runs on this file, so the view
 * is only ever constructed inside `useLayoutEffect`, kept in a ref, and
 * reached by effects; callbacks flow through a ref so the view never closes
 * over stale props. Nothing here reads or writes a ref during render.
 */
export function IdeEditor(props: IdeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const highlightCompartmentRef = useRef<Compartment | null>(null);
  // Set around external-content dispatches so the update listener does not
  // echo agent-driven reloads back as user edits.
  const applyingExternalContentsRef = useRef(false);
  const callbacksRef = useRef({ onUserEdit: props.onUserEdit, onFocusChange: props.onFocusChange });
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    callbacksRef.current = { onUserEdit: props.onUserEdit, onFocusChange: props.onFocusChange };
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const languageCompartment = new Compartment();
    const highlightCompartment = new Compartment();
    highlightCompartmentRef.current = highlightCompartment;

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- initial contents seed the buffer; later contents arrive through the external-contents effect.
        doc: props.initialContents,
        extensions: [
          ideBaseExtensions({ wordWrap }),
          ideEditorChrome,
          languageCompartment.of([]),
          highlightCompartment.of([]),
          EditorState.readOnly.of(props.readOnly),
          EditorView.editable.of(!props.readOnly),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingExternalContentsRef.current) {
              callbacksRef.current.onUserEdit(update.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            focus: () => callbacksRef.current.onFocusChange?.(true),
            blur: () => callbacksRef.current.onFocusChange?.(false),
          }),
        ],
      }),
    });
    viewRef.current = view;

    let cancelled = false;
    void loadIdeLanguage(ideLanguageForPath(props.path)).then((language) => {
      if (cancelled || viewRef.current !== view) return;
      view.dispatch({ effects: languageCompartment.reconfigure(language) });
    });
    void loadIdeSyntaxHighlighting(resolvedTheme).then((highlighting) => {
      if (cancelled || viewRef.current !== view) return;
      view.dispatch({ effects: highlightCompartment.reconfigure(highlighting) });
    });

    return () => {
      cancelled = true;
      viewRef.current = null;
      highlightCompartmentRef.current = null;
      view.destroy();
    };
    // Buffer identity and structural options rebuild the view; contents and
    // callbacks flow through refs and sibling effects instead.
  }, [props.bufferKey, props.readOnly, wordWrap]);

  // Swap the syntax palette when the app theme resolves to a different mode.
  useEffect(() => {
    let cancelled = false;
    void loadIdeSyntaxHighlighting(resolvedTheme).then((highlighting) => {
      const view = viewRef.current;
      const compartment = highlightCompartmentRef.current;
      if (cancelled || view === null || compartment === null) return;
      view.dispatch({ effects: compartment.reconfigure(highlighting) });
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedTheme]);

  // Push external contents (agent edits, conflict resolutions) into the view.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const current = view.state.doc.toString();
    if (current === props.contents) return;
    applyingExternalContentsRef.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: props.contents },
    });
    applyingExternalContentsRef.current = false;
  }, [props.contents]);

  return <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />;
}
