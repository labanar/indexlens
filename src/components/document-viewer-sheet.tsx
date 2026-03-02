import { useRef, useEffect } from "react";
import { EditorView, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { foldGutter } from "@codemirror/language";
import { cmViewerTheme } from "@/lib/codemirror-theme";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

interface SearchHit {
  _id: string;
  _source: Record<string, unknown>;
}

interface DocumentViewerSheetProps {
  hit: SearchHit | null;
  onClose: () => void;
}

export function DocumentViewerSheet({ hit, onClose }: DocumentViewerSheetProps) {
  return (
    <Sheet open={hit !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="sm:max-w-xl w-full flex flex-col">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm truncate">
            {hit?._id}
          </SheetTitle>
          <SheetDescription>Document source</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-hidden rounded-md border">
          {hit && <JsonViewer value={hit._source} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function JsonViewer({ value }: { value: unknown }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const formatted = JSON.stringify(value, null, 2);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: formatted,
      extensions: [
        EditorState.readOnly.of(true),
        json(),
        cmViewerTheme,
        lineNumbers(),
        foldGutter(),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [formatted]);

  return <div ref={containerRef} className="h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none" />;
}
