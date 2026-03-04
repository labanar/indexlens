import type { MappingField } from "@/lib/es-mapping";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type TokenType =
  | "field"
  | "op"
  | "value"
  | "and"
  | "or"
  | "not"
  | "lparen"
  | "rparen";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const OPERATORS = ["!=", ">=", "<=", ">", "<", ":"] as const;
type Operator = (typeof OPERATORS)[number];

function isOperator(v: string): v is Operator {
  return (OPERATORS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    // parentheses
    if (input[i] === "(") {
      tokens.push({ type: "lparen", value: "(", pos: i });
      i++;
      continue;
    }
    if (input[i] === ")") {
      tokens.push({ type: "rparen", value: ")", pos: i });
      i++;
      continue;
    }

    // && / ||
    if (input[i] === "&" && input[i + 1] === "&") {
      tokens.push({ type: "and", value: "&&", pos: i });
      i += 2;
      continue;
    }
    if (input[i] === "|" && input[i + 1] === "|") {
      tokens.push({ type: "or", value: "||", pos: i });
      i += 2;
      continue;
    }

    // two-char operators first, then single-char
    const twoChar = input.slice(i, i + 2);
    if (twoChar === "!=" || twoChar === ">=" || twoChar === "<=") {
      tokens.push({ type: "op", value: twoChar, pos: i });
      i += 2;
      continue;
    }
    if (input[i] === ">" || input[i] === "<" || input[i] === ":") {
      tokens.push({ type: "op", value: input[i], pos: i });
      i++;
      continue;
    }

    // quoted string
    if (input[i] === '"') {
      const start = i;
      i++; // skip opening quote
      let str = "";
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < input.length) {
          str += input[i + 1];
          i += 2;
        } else {
          str += input[i];
          i++;
        }
      }
      if (i < input.length) i++; // skip closing quote
      tokens.push({ type: "value", value: str, pos: start });
      continue;
    }

    // wildcard `*` (used for exists queries: field: *)
    if (input[i] === "*") {
      tokens.push({ type: "field", value: "*", pos: i });
      i++;
      continue;
    }

    // bare word (field name, value, NOT keyword)
    const start = i;
    while (i < input.length && /[^\s()&|:!><="]/.test(input[i])) {
      i++;
    }
    if (i === start) {
      throw new ParseError(`Unexpected character: ${input[i]}`, i);
    }
    const word = input.slice(start, i);

    if (word === "NOT") {
      tokens.push({ type: "not", value: word, pos: start });
    } else {
      // Will be classified as field or value based on context during parsing
      tokens.push({ type: "field", value: word, pos: start });
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

interface ComparisonNode {
  type: "comparison";
  field: string;
  operator: Operator;
  value: string | number;
}

interface BoolNode {
  type: "bool";
  op: "and" | "or";
  children: AstNode[];
}

interface NotNode {
  type: "not";
  child: AstNode;
}

type AstNode = ComparisonNode | BoolNode | NotNode;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export class ParseError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.name = "ParseError";
    this.pos = pos;
  }
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): AstNode {
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      const tok = this.tokens[this.pos];
      throw new ParseError(
        `Unexpected token: "${tok.value}"`,
        tok.pos,
      );
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): Token {
    const tok = this.peek();
    if (!tok || tok.type !== type) {
      const pos = tok?.pos ?? this.inputEnd();
      throw new ParseError(
        `Expected ${type}` + (tok ? `, got "${tok.value}"` : ""),
        pos,
      );
    }
    return this.advance();
  }

  private inputEnd(): number {
    if (this.tokens.length === 0) return 0;
    const last = this.tokens[this.tokens.length - 1];
    return last.pos + last.value.length;
  }

  private parseOr(): AstNode {
    const children: AstNode[] = [this.parseAnd()];
    while (this.peek()?.type === "or") {
      this.advance();
      children.push(this.parseAnd());
    }
    return children.length === 1
      ? children[0]
      : { type: "bool", op: "or", children };
  }

  private parseAnd(): AstNode {
    const children: AstNode[] = [this.parseUnary()];
    while (this.peek()?.type === "and") {
      this.advance();
      children.push(this.parseUnary());
    }
    return children.length === 1
      ? children[0]
      : { type: "bool", op: "and", children };
  }

  private parseUnary(): AstNode {
    if (this.peek()?.type === "not") {
      this.advance();
      return { type: "not", child: this.parseUnary() };
    }
    return this.parseAtom();
  }

  private parseAtom(): AstNode {
    const tok = this.peek();
    if (!tok) {
      throw new ParseError("Unexpected end of expression", this.inputEnd());
    }

    // grouped expression
    if (tok.type === "lparen") {
      this.advance();
      const node = this.parseOr();
      this.expect("rparen");
      return node;
    }

    // comparison: field op value
    if (tok.type === "field") {
      const fieldTok = this.advance();
      const opTok = this.peek();
      if (!opTok || opTok.type !== "op") {
        throw new ParseError(
          `Expected operator after "${fieldTok.value}"`,
          opTok?.pos ?? this.inputEnd(),
        );
      }
      if (!isOperator(opTok.value)) {
        throw new ParseError(`Unknown operator: "${opTok.value}"`, opTok.pos);
      }
      const operator = opTok.value as Operator;
      this.advance();

      const valTok = this.peek();
      if (!valTok || (valTok.type !== "field" && valTok.type !== "value")) {
        throw new ParseError(
          `Expected value after "${operator}"`,
          valTok?.pos ?? this.inputEnd(),
        );
      }
      this.advance();

      const raw = valTok.value;
      const numericValue = Number(raw);
      const value = !isNaN(numericValue) && raw !== "" ? numericValue : raw;

      return { type: "comparison", field: fieldTok.value, operator, value };
    }

    throw new ParseError(`Unexpected token: "${tok.value}"`, tok.pos);
  }
}

// ---------------------------------------------------------------------------
// Compiler: AST → ES query
// ---------------------------------------------------------------------------

const TERM_FIELD_TYPES = new Set([
  "keyword",
  "boolean",
  "long",
  "integer",
  "short",
  "byte",
  "float",
  "double",
  "half_float",
  "scaled_float",
  "ip",
  "date",
]);

function buildFieldMap(fields: MappingField[]): Map<string, MappingField> {
  const map = new Map<string, MappingField>();
  for (const f of fields) {
    map.set(f.path, f);
  }
  return map;
}

function shouldUseTerm(field: string, fieldMap: Map<string, MappingField>): boolean {
  if (field.endsWith(".keyword")) return true;
  const info = fieldMap.get(field);
  if (!info) return false;
  return TERM_FIELD_TYPES.has(info.type);
}

const RANGE_OP_MAP: Record<string, string> = {
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
};

function compile(
  node: AstNode,
  fieldMap: Map<string, MappingField>,
): object {
  switch (node.type) {
    case "comparison": {
      const { field, operator, value } = node;

      if (operator === ":" && value === "*") {
        return { exists: { field } };
      }

      if (operator === ":") {
        if (shouldUseTerm(field, fieldMap)) {
          return { term: { [field]: value } };
        }
        return { match: { [field]: value } };
      }

      if (operator === "!=") {
        return {
          bool: {
            must_not: [{ term: { [field]: value } }],
          },
        };
      }

      const rangeKey = RANGE_OP_MAP[operator];
      if (rangeKey) {
        return { range: { [field]: { [rangeKey]: value } } };
      }

      return { match: { [field]: value } };
    }

    case "bool": {
      const children = node.children.map((c) => compile(c, fieldMap));
      if (node.op === "and") {
        return { bool: { must: children } };
      }
      return { bool: { should: children } };
    }

    case "not": {
      return {
        bool: { must_not: [compile(node.child, fieldMap)] },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function compileToEsQuery(
  input: string,
  fields: MappingField[],
): object {
  const trimmed = input.trim();
  if (!trimmed) return { match_all: {} };

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return { match_all: {} };

  const ast = new Parser(tokens).parse();
  const fieldMap = buildFieldMap(fields);
  return compile(ast, fieldMap);
}
