import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Teletext } from "@techandsoftware/teletext";
import type { TeletextScreen } from "@techandsoftware/teletext";
import useWebSocket, { ReadyState } from "react-use-websocket";
import "./main.css";

function App() {
  const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;

  const { sendMessage, lastMessage, readyState } = useWebSocket(wsUrl);

  const connectionStatus = {
    [ReadyState.CONNECTING]: "Connecting",
    [ReadyState.OPEN]: "Open",
    [ReadyState.CLOSING]: "Closing",
    [ReadyState.CLOSED]: "Closed",
    [ReadyState.UNINSTANTIATED]: "Uninstantiated",
  }[readyState];

  const sendKey = useCallback((key: string) => {
    if (readyState === ReadyState.OPEN) {
      sendMessage(JSON.stringify({ type: "key", key }));
    }
  }, []);

  // Capture keyboard input and send to server
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier-only presses and shortcut combos
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key === "Enter") {
        e.preventDefault();
        sendKey("Enter");
      } else if (e.key.length === 1) {
        // Single printable character (letters, digits, symbols, space)
        sendMessage(JSON.stringify({ type: "key", key: e.key }));
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sendKey]);

  useEffect(() => {
    if (!teletextRef.current || !lastMessage?.data) return;
    const payload = JSON.parse(lastMessage?.data || "{}");
    if (payload.type == "frame") {
      const screen = teletextRef.current;
      screen.clearScreen(false);
      screen.setPageRows(payload.rows);
    }
  }, [lastMessage]);

  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      sendMessage(JSON.stringify({ type: "init" }));
    }
  }, [readyState]);

  const containerRef = useRef<HTMLDivElement>(null);
  const teletextRef = useRef<TeletextScreen | null>(null);
  const [showGrid, setShowGrid] = useState(false);

  // Initialize the teletext screen once
  useEffect(() => {
    if (!containerRef.current) return;

    const screen = Teletext();
    screen.addTo("#teletext-display");
    teletextRef.current = screen;

    return () => {
      screen.destroy();
      screen.remove();
      teletextRef.current = null;
    };
  }, []);

  const handleToggleGrid = useCallback(() => {
    if (teletextRef.current) {
      teletextRef.current.toggleGrid();
      setShowGrid((prev) => !prev);
    }
  }, []);

  return (
    <div className="app">
      <div className="viewer-area">
        <p>{connectionStatus}</p>
        <div className="viewer-container">
          <div
            id="teletext-display"
            className="teletext-screen"
            ref={containerRef}
          />
          <div className="controls">
            <button
              onClick={handleToggleGrid}
              className={showGrid ? "active" : ""}
            >
              Grid
            </button>
            <button>{connectionStatus}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
