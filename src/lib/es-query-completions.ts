import type {
  CompletionContext,
  CompletionResult,
  Completion,
} from "@codemirror/autocomplete";
import type { MappingField } from "@/lib/es-mapping";

function buildFieldCompletions(fields: MappingField[]): Completion[] {
  return fields.map((f) => ({
    label: f.path,
    type: "variable",
    detail: f.type + (f.isSubfield ? " (sub-field)" : ""),
    boost: f.isSubfield ? -1 : 0,
  }));
}

export function fieldCompletions(fields: MappingField[]) {
  const completions = buildFieldCompletions(fields);

  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w.]*/);
    if (!word) return null;
    if (word.from === word.to && !context.explicit) return null;

    return {
      from: word.from,
      options: completions,
      filter: true,
    };
  };
}
