import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Teletext } from "@techandsoftware/teletext";
import type { TeletextScreen } from "@techandsoftware/teletext";
import useWebSocket, { ReadyState } from "react-use-websocket";
import "./main.css";

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const teletextRef = useRef<TeletextScreen | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [powerOn, setPowerOn] = useState(true);

  const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;

  const { getWebSocket, sendJsonMessage, lastJsonMessage, readyState } =
    useWebSocket(powerOn ? wsUrl : null, {
      shouldReconnect: (closeEvent) => false,
    });

  const connectionStatus = {
    [ReadyState.CONNECTING]: "Connecting",
    [ReadyState.OPEN]: "Open",
    [ReadyState.CLOSING]: "Closing",
    [ReadyState.CLOSED]: "Closed",
    [ReadyState.UNINSTANTIATED]: "Uninstantiated",
  }[readyState];

  const sendKey = useCallback((key: string) => {
    if (readyState === ReadyState.OPEN) {
      sendJsonMessage({ type: "key", key });
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
        sendJsonMessage({ type: "key", key: e.key });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sendKey]);

  useEffect(() => {
    if (!teletextRef.current || !lastJsonMessage) return;
        const screen = teletextRef.current;
    switch (lastJsonMessage?.type) {
      case "frame":
        screen.clearScreen(false);
        screen.setPageRows(lastJsonMessage.data);
        break;
      case "row":
        //screen.clearScreen(false);
        screen.setRow(lastJsonMessage.row, lastJsonMessage.data)
        break;
    }
  }, [lastJsonMessage]);

  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      sendJsonMessage({ type: "init" });
    }
  }, [readyState]);

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

  const handlePowerToggle = () => {
    setPowerOn((prev) => !prev);
  };

  return (
    <div className="app">
      <div className="crt-tv">
        <div className="crt-body">
          <div className="crt-screen-frame">
            <div className={`crt-screen ${!powerOn ? "off" : ""}`}>
              <div
                id="teletext-display"
                className="teletext-screen"
                ref={containerRef}
              />
              <div className="crt-overlay" />
            </div>
          </div>
          <div className="crt-panel">
            <button
              onClick={() => handlePowerToggle()}
              className={`crt-power ${powerOn ? "on" : ""}`}
              title="Power"
            />
            <div className="crt-panel-right">
              <div className="crt-knobs">
                <button
                  onClick={handleToggleGrid}
                  className={`crt-knob ${showGrid ? "active" : ""}`}
                  title="Toggle Grid"
                />
                <div
                  className={`crt-indicator ${readyState === ReadyState.OPEN ? "on" : ""}`}
                  title={connectionStatus}
                />
                <div className="crt-channel-label" />
              </div>
            </div>
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
