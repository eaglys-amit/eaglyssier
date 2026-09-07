import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Mermaid } from "@/components/shared/Mermaid";
import { cn } from "@/lib/utils";

/**
 * Generated markdown, rendered.
 *
 * No rehype-raw, ever: this text comes out of a model and is then editable in a
 * textarea, so allowing raw HTML through would make a documentation set a
 * stored XSS vector. react-markdown escapes HTML by default and sanitises
 * `javascript:` URLs in its default urlTransform — both of those are the
 * security model here, not an inconvenience to work around. The one apparent
 * exception is Mermaid, and the note in that file explains why it isn't one.
 *
 * Styling is the `.markdown` class in index.css rather than
 * @tailwindcss/typography — see the comment on that block.
 */
/**
 * The diagram source inside a ```mermaid fence, or null for any other <pre>.
 *
 * Read off the hast node rather than the rendered children because those are
 * React elements by this point, and re-deriving text from them would be
 * guesswork.
 */
function mermaidSource(node: unknown): string | null {
  const el = node as
    | {
        children?: Array<{
          tagName?: string;
          properties?: { className?: unknown };
          children?: Array<{ type?: string; value?: string }>;
        }>;
      }
    | undefined;
  const code = el?.children?.[0];
  if (code?.tagName !== "code") return null;
  const classes = code.properties?.className;
  const list = Array.isArray(classes) ? classes.map(String) : [String(classes ?? "")];
  if (!list.includes("language-mermaid")) return null;
  const text = (code.children ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.value ?? "")
    .join("");
  return text.replace(/\n$/, "");
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn("markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Generated docs link out to the platform; opening one over the app
          // would lose an unsaved draft in the pane behind it.
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          // A GFM table wider than the pane has to scroll itself — otherwise it
          // stretches the flex column and the whole two-pane layout overflows
          // sideways, which also breaks the sticky tab strip.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          // Mermaid is intercepted on `pre`, not on `code`, for two reasons:
          // a diagram must replace the <pre> shell rather than render inside a
          // mono-font code block, and only a fence has a <pre> — inline
          // `mermaid` in prose stays inline code without needing a guard.
          pre: ({ children, node }) => {
            const chart = mermaidSource(node);
            return chart === null ? <pre>{children}</pre> : <Mermaid chart={chart} />;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
