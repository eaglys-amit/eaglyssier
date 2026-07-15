import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

import { wsUrl } from "@/lib/ws";

interface Props {
  /** WS path on the same origin, e.g. `/projects/3/terminal/ws`. */
  wsPath: string;
  /** Project terminal sends keystrokes as binary frames; login PTY as text. */
  sendBinary?: boolean;
  /** Fit to container + send resize control messages (login PTY is fixed 100x30). */
  fitToContainer?: boolean;
  className?: string;
  onClosed?: () => void;
}

export function XtermTerminal({
  wsPath,
  sendBinary = true,
  fitToContainer = true,
  className,
  onClosed,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: true,
      ...(fitToContainer ? {} : { cols: 100, rows: 30 }),
      theme: { background: "#0b0f14" },
    });
    const fit = new FitAddon();
    if (fitToContainer) term.loadAddon(fit);
    term.open(host);
    if (fitToContainer && host.clientWidth > 0) fit.fit();
    term.focus();

    const ws = new WebSocket(wsUrl(wsPath));
    ws.binaryType = "arraybuffer";

    const sendResize = () => {
      if (fitToContainer && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
      }
    };
    ws.onopen = sendResize;
    ws.onmessage = (e) => {
      term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer));
    };
    const dataSub = term.onData((d) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(sendBinary ? new TextEncoder().encode(d) : d);
    });
    ws.onclose = () => {
      term.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
      onClosedRef.current?.();
    };
    ws.onerror = () => term.write("\r\n\x1b[31m[connection error]\x1b[0m\r\n");

    // Refits when the tab is revealed again (display:none -> block) and on
    // real resizes; the clientWidth guard skips fits while hidden.
    const ro = new ResizeObserver(() => {
      if (host.clientWidth > 0) {
        fit.fit();
        sendResize();
      }
    });
    if (fitToContainer) ro.observe(host);

    return () => {
      ro.disconnect();
      dataSub.dispose();
      ws.close();
      term.dispose();
    };
  }, [wsPath, sendBinary, fitToContainer]);

  return (
    <div
      ref={hostRef}
      className={className ?? "h-[520px] overflow-hidden rounded-lg border bg-[#0b0f14] p-2"}
    />
  );
}
