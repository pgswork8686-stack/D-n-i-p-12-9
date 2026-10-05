/**
 * Minimal, strict frontmatter parser for SKILL.md files.
 *
 * Supports exactly the YAML subset the Agent Skills format uses:
 *   key: scalar
 *   key:
 *     nested: scalar
 *     list:
 *       - item
 *   key: [a, b, c]
 * Anything else (anchors, multi-line strings, tags, flow maps) is rejected so a malformed or
 * malicious skill file fails loudly instead of being half-parsed. No external YAML dependency.
 */
export type FrontmatterValue = string | number | boolean | string[] | { [key: string]: FrontmatterValue };
export type Frontmatter = { [key: string]: FrontmatterValue };

const BOM = new RegExp("^" + String.fromCharCode(0xfeff));

export class FrontmatterError extends Error {}

function parseScalar(raw: string, line: number): string | number | boolean | string[] {
  const v = raw.trim();
  if (v === "") throw new FrontmatterError(`line ${line}: empty value`);
  if (/^[&*!|>]/.test(v)) throw new FrontmatterError(`line ${line}: unsupported YAML syntax`);
  if (v.startsWith("[")) {
    if (!v.endsWith("]")) throw new FrontmatterError(`line ${line}: unterminated list`);
    const inner = v.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim(), line));
  }
  if (v === "true" || v === "false") return v === "true";
  if (/^-?\d+(\.\d+)?$/.test(v) && !/^\d+\.\d+\.\d+/.test(v)) return Number(v);
  return unquote(v, line);
}

function unquote(v: string, line: number): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v.startsWith('"') || v.startsWith("'")) throw new FrontmatterError(`line ${line}: unterminated quote`);
  return v;
}

export function parseFrontmatter(source: string): { data: Frontmatter; body: string } {
  const text = source.replace(/\r\n/g, "\n").replace(BOM, "");
  if (!text.startsWith("---\n")) throw new FrontmatterError("missing frontmatter (file must start with ---)");
  const end = text.indexOf("\n---", 4);
  if (end < 0) throw new FrontmatterError("unterminated frontmatter");
  const header = text.slice(4, end).split("\n");
  const body = text.slice(end + 4).replace(/^\n/, "");

  const root: Frontmatter = {};
  // stack of [indent, container, pendingListKey]
  const stack: { indent: number; obj: Frontmatter }[] = [{ indent: -1, obj: root }];
  let currentList: { indent: number; list: string[] } | null = null;

  header.forEach((rawLine, i) => {
    const lineNo = i + 2;
    if (rawLine.trim() === "" || rawLine.trim().startsWith("#")) return;
    if (/\t/.test(rawLine)) throw new FrontmatterError(`line ${lineNo}: tabs are not allowed`);
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (line.startsWith("- ")) {
      if (!currentList || indent <= stack[stack.length - 1].indent) throw new FrontmatterError(`line ${lineNo}: list item without a list key`);
      const item = parseScalar(line.slice(2), lineNo);
      if (typeof item !== "string" && typeof item !== "number") throw new FrontmatterError(`line ${lineNo}: list items must be scalars`);
      currentList.list.push(String(item));
      return;
    }
    currentList = null;

    const m = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!m) throw new FrontmatterError(`line ${lineNo}: expected "key: value"`);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    const key = m[1];
    if (key in parent) throw new FrontmatterError(`line ${lineNo}: duplicate key "${key}"`);
    const rest = m[2].trim();
    if (rest === "") {
      // nested map or list: decided by the next line
      const next = header.slice(i + 1).find((l) => l.trim() !== "");
      if (next && next.trim().startsWith("- ")) {
        const list: string[] = [];
        parent[key] = list;
        currentList = { indent, list };
      } else {
        const child: Frontmatter = {};
        parent[key] = child;
        stack.push({ indent, obj: child });
      }
    } else {
      parent[key] = parseScalar(rest, lineNo);
    }
  });
  return { data: root, body };
}
