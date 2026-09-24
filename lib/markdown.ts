/**
 * A small, dependency-free renderer for the limited Markdown subset the report-writing
 * prompts ask Claude to use: h2 (`##`) and h3 (`###`) headings, one level of nested bullets
 * (a `- ` or `* ` line indented under another), and inline `**bold**`. Input is HTML-escaped
 * first, so this is safe to render with dangerouslySetInnerHTML even though the content comes
 * from an LLM.
 */

interface ListNode {
  html: string;
  children: ListNode[];
}

export function renderMarkdown(markdown: string): string {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split("\n");
  const htmlParts: string[] = [];

  let listBuffer: { indent: number; text: string }[] = [];
  let paragraphBuffer: string[] = [];

  function flushList() {
    if (listBuffer.length > 0) {
      htmlParts.push(renderList(buildListTree(listBuffer)));
      listBuffer = [];
    }
  }

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      htmlParts.push(`<p>${paragraphBuffer.join(" ")}</p>`);
      paragraphBuffer = [];
    }
  }

  for (const rawLine of lines) {
    // Trim trailing whitespace but keep leading spaces around so bullet nesting can be
    // detected, then measure and strip the indent separately.
    const withoutTrailing = rawLine.replace(/\s+$/, "");
    const stripped = withoutTrailing.replace(/^\s+/, "");
    const indent = withoutTrailing.length - stripped.length;

    if (stripped === "") {
      flushList();
      flushParagraph();
    } else if (stripped.startsWith("### ")) {
      flushList();
      flushParagraph();
      htmlParts.push(`<h3>${inlineFormat(stripped.slice(4))}</h3>`);
    } else if (stripped.startsWith("## ")) {
      flushList();
      flushParagraph();
      htmlParts.push(`<h2>${inlineFormat(stripped.slice(3))}</h2>`);
    } else if (stripped.startsWith("# ")) {
      flushList();
      flushParagraph();
      htmlParts.push(`<h2>${inlineFormat(stripped.slice(2))}</h2>`);
    } else if (stripped.startsWith("- ") || stripped.startsWith("* ")) {
      flushParagraph();
      listBuffer.push({ indent, text: inlineFormat(stripped.slice(2)) });
    } else {
      flushList();
      paragraphBuffer.push(inlineFormat(stripped));
    }
  }
  flushList();
  flushParagraph();

  return htmlParts.join("\n");
}

/** Groups a flat list of {indent, text} bullets into one level of nesting: any bullet with
 *  indent > 0 becomes a child of the most recent indent-0 bullet (a nested bullet with no
 *  preceding top-level bullet is just treated as top-level -- deliberately simple rather than
 *  a full arbitrary-depth outline parser, since that's all the report prompts ever ask for). */
function buildListTree(items: { indent: number; text: string }[]): ListNode[] {
  const top: ListNode[] = [];
  let currentParent: ListNode | null = null;

  for (const { indent, text } of items) {
    const node: ListNode = { html: text, children: [] };
    if (indent === 0 || !currentParent) {
      top.push(node);
      currentParent = node;
    } else {
      currentParent.children.push(node);
    }
  }

  return top;
}

function renderList(nodes: ListNode[]): string {
  return `<ul>${nodes
    .map((n) => `<li>${n.html}${n.children.length ? renderList(n.children) : ""}</li>`)
    .join("")}</ul>`;
}

function inlineFormat(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
