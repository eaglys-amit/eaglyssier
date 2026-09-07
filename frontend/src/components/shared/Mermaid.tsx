import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "next-themes";

import { Spinner } from "@/components/shared/Spinner";

/**
 * One ```mermaid fence from a generated document, rendered to SVG.
 *
 * mermaid.render() returns an SVG *string*, so this is the only
 * dangerouslySetInnerHTML in the app — and the only reason it is acceptable
 * next to Markdown.tsx's flat "no raw HTML, ever" is that the string is
 * produced by mermaid's own parser from diagram source. The model's text is an
 * *input to a parser* here, never markup that reaches the DOM. Two settings
 * hold that line and neither is a default worth trusting implicitly:
 * securityLevel "strict" (no click handlers, no href actions) and
 * htmlLabels false (labels become <text>, so a label cannot smuggle an
 * element). If someone later asks for rehype-raw to make a <details> block
 * work, the answer is a markdown-native alternative, not a sanitiser.
 */

/** Loaded once per session, not per diagram: a document can hold ten fences. */
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    // Dynamic so the ~450KB payload never lands in the initial bundle — most
    // documents contain no diagram at all. vite.config.ts names the chunk.
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; svg: string }
  | { kind: "failed"; message: string };

export function Mermaid({ chart }: { chart: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const { resolvedTheme } = useTheme();
  // useId is stable across re-renders but unique per instance. Mermaid requires
  // a unique id per render — reusing one renders the second diagram blank.
  const rawId = useId();
  const idRef = useRef(`mermaid-${rawId.replace(/[^a-zA-Z0-9-]/g, "")}`);

  useEffect(() => {
    // render() is async, so a Preview -> Edit flip mid-render would otherwise
    // set state on an unmounted node.
    let cancelled = false;

    (async () => {
      setState({ kind: "loading" });
      try {
        const mermaid = await loadMermaid();
        if (cancelled) return;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // resolvedTheme, not theme: main.tsx sets defaultTheme="system", so
          // `theme` is literally "system" for most users and would pick the
          // wrong palette every time.
          theme: resolvedTheme === "dark" ? "dark" : "default",
          flowchart: { htmlLabels: false },
          fontFamily: "var(--font-sans)",
        });

        // Parse first so mermaid never handles its own errors: on failure it
        // injects a bright red error graphic at a detached node and leaves it
        // there, which in a twenty-diagram document is far worse than showing
        // the source as a code block.
        await mermaid.parse(chart);
        if (cancelled) return;

        const { svg } = await mermaid.render(idRef.current, chart);
        if (!cancelled) setState({ kind: "ready", svg });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "failed",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, resolvedTheme]);

  if (state.kind === "loading") {
    return (
      <div className="mermaid-figure">
        <Spinner />
      </div>
    );
  }

  // Graceful degradation: the diagram source is still the most useful thing we
  // can show, and a model gets `gantt` and `erDiagram` syntax wrong often
  // enough that this path is a normal outcome, not an exceptional one.
  if (state.kind === "failed") {
    return (
      <div>
        <pre>
          <code>{chart}</code>
        </pre>
        <p className="text-muted-foreground -mt-1 text-xs">
          This diagram could not be rendered, so its source is shown above.
        </p>
      </div>
    );
  }

  return (
    <div
      className="mermaid-figure"
      role="img"
      // Safe by construction: see the note at the top of this file.
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
