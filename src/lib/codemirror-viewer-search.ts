import type { EditorView } from "@codemirror/view";
import { EditorView as CmEditorView } from "@codemirror/view";
import {
  SearchQuery,
  findNext,
  findPrevious,
  getSearchQuery,
  search,
  setSearchQuery,
} from "@codemirror/search";

export interface ViewerSearchState {
  activeMatch: number;
  hasMatches: boolean;
  query: string;
  totalMatches: number;
}

const EMPTY_STATE: ViewerSearchState = {
  activeMatch: 0,
  hasMatches: false,
  query: "",
  totalMatches: 0,
};

function buildQuery(query: string): SearchQuery {
  return new SearchQuery({ search: query });
}

export function createViewerSearchExtensions(onUpdate: (view: EditorView) => void) {
  return [
    search({ top: false }),
    CmEditorView.updateListener.of((update) => {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)))
      ) {
        onUpdate(update.view);
      }
    }),
  ];
}

export function readViewerSearchState(view: EditorView): ViewerSearchState {
  const query = getSearchQuery(view.state);
  if (!query.search) return EMPTY_STATE;

  const cursor = query.getCursor(view.state.doc);
  const selectionHead = view.state.selection.main.head;
  let totalMatches = 0;
  let activeMatch = 0;

  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    const { from, to } = next.value;
    totalMatches += 1;
    if (selectionHead >= from && selectionHead <= to) {
      activeMatch = totalMatches;
    }
  }

  if (totalMatches > 0 && activeMatch === 0) {
    activeMatch = 1;
  }

  return {
    activeMatch,
    hasMatches: totalMatches > 0,
    query: query.search,
    totalMatches,
  };
}

export function setViewerSearchQuery(
  view: EditorView,
  query: string,
  opts?: { scrollToFirst?: boolean },
): ViewerSearchState {
  const nextQuery = buildQuery(query);
  view.dispatch({
    effects: setSearchQuery.of(nextQuery),
  });

  if (query && opts?.scrollToFirst) {
    view.dispatch({
      selection: { anchor: 0 },
      scrollIntoView: true,
    });
    findNext(view);
  }

  return readViewerSearchState(view);
}

export function nextViewerSearchMatch(view: EditorView): ViewerSearchState {
  findNext(view);
  return readViewerSearchState(view);
}

export function previousViewerSearchMatch(view: EditorView): ViewerSearchState {
  findPrevious(view);
  return readViewerSearchState(view);
}
