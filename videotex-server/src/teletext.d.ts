declare module "@techandsoftware/teletext" {
  interface TeletextScreen {
    addTo(selector: string): void;
    remove(): void;
    destroy(): void;
    setPageRows(rows: string[]): void;
    setRow(rowNum: number, row: string): void;
    setRowFromOutputLine(rowNum: number, line: string): void;
    clearScreen(withUpdate?: boolean): void;
    showTestPage(name?: string): void;
    toggleReveal(): void;
    toggleMixMode(): void;
    toggleGrid(): void;
    setLevel(level: symbol): void;
    setAspectRatio(value: number | "natural"): void;
    setHeight(pixels: number): void;
    setFont(font: string): void;
    setView(view: string): void;
    getBytes(): Uint8Array;
    getScreenImage(): string;
    updateDisplay(): void;
  }

  interface TeletextOptions {
    webkitCompat?: boolean;
    dom?: Window;
  }

  export function Teletext(options?: TeletextOptions): TeletextScreen;

  export const Level: {
    [key: string]: symbol;
  };

  export const Colour: {
    BLACK: symbol;
    RED: symbol;
    GREEN: symbol;
    YELLOW: symbol;
    BLUE: symbol;
    MAGENTA: symbol;
    CYAN: symbol;
    WHITE: symbol;
  };
}
