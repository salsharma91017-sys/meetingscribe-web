/**
 * A small, dependency-free renderer for the limited Markdown subset the
 * report-writing prompt asks Claude to use (##, - bullets, **bold**,
 * plain paragraphs). Input is HTML-escaped first, so this is safe to render
 * with dangerouslySetInnerHTML even though the content comes from an LLM.
 */
export function renderMarkdown(markdown: string): string {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split("\n");
  const htmlParts: string[] = [];

  let listBuffer: string[] = [];
  let paragraphBuffer: string[] = [];

  function flushList() {
    if (listBuffer.length > 0) {
      htmlParts.push(`<ul>${listBuffer.map((item) => `<li>${item}</li>`).join("")}</ul>`);
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
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      flushList();
      flushParagraph();
      htmlParts.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      flushList();
      flushParagraph();
      htmlParts.push(`<h2>${inlineFormat(line.slice(2))}</h2>`);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      listBuffer.push(inlineFormat(line.slice(2)));
    } else if (line === "") {
      flushList();
      flushParagraph();
    } else {
      flushList();
      paragraphBuffer.push(inlineFormat(line));
    }
  }
  flushList();
  flushParagraph();

  return htmlParts.join("\n");
}

function inlineFormat(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
