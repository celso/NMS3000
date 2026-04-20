import { CELLS_PER_ROW, TOTAL_ROWS } from "~lib/characterCodes";
import { characterCodes, noEscCodes } from "../lib/characterCodes";

export function encodeViewdata(rows: string[]): Uint8Array {
  const bytes: number[] = [];

  for (const row of rows) {
    for (let col = 0; col < row.length; col++) {
      const code = row.charCodeAt(col);
      if (code < 0x20) {
        // Control code — ESC-encode it
        bytes.push(0x1b, code + 0x40);
      } else {
        bytes.push(code);
      }
    }
  }

  return new Uint8Array(bytes);
}

export function decodeViewdataRaw(buffer: Uint8Array): string[] {
  const bytes = buffer;
  const rows: string[] = [];
  let i = 0;

  while (i < bytes.length) {
    let row = "";
    let col = 0;

    while (col < CELLS_PER_ROW && i < bytes.length) {
      if (bytes[i] === 0x1b && i + 1 < bytes.length) {
        // ESC-encoded control code
        row += String.fromCharCode(bytes[i + 1] - 0x40);
        i += 2;
      } else {
        row += String.fromCharCode(bytes[i]);
        i++;
      }
      col++;
    }

    rows.push(row);
  }

  return rows;
}

export const serverSend = async (session: any, payloads: any) => {
  for (const payload of Array.isArray(payloads)
    ? payloads
    : new Array(payloads)) {
    let data = payload;
    if (typeof payload == "string") {
      const codes = parseCodes(session, payload);
      data = codes.data;
      if (codes.clearScreen && session.type == "rows") {
        session.server.send(
          JSON.stringify({
            type: "clear",
          }),
        );
      }
    }

    if (session.type == "rows") {
      // rows data go one at a time
      const rows = decodeViewdataRaw(data);
      //console.log("Sending rows:");
      //console.log(rows);
      rows.forEach((row: any, i: any) => {
        session.server.send(
          JSON.stringify({
            type: "row",
            row: session.cursor[0] + i,
            data: row,
          }),
        );
      });
    }

    if (session.type == "viewdata") {
      // viewdata is streamed, send frame in one take
      session.server.send(
        JSON.stringify({
          type: "frame",
          data: btoa(String.fromCharCode(...data)),
        }),
      );
    }
  }
};

/**
 * Parse a template string containing { code } blocks and plain text.
 *
 * Syntax: '{ codeName }text{ codeName(arg1, arg2) }more text'
 *
 * Supported code forms:
 *   { AlphaRed }          — emit the named control byte
 *   { go(col, row) }      — position cursor: EscHome + row×EscLf + col×space
 *
 * All named codes correspond to keys of characterCodes from lib/characterCodes.ts.
 *
 * Returns a viewdata-encoded Uint8Array (control bytes ESC-encoded as 1B XX).
 */
export const parseCodes = (session: any, codes: string) => {
  // Tokenise into code blocks { ... } and intervening text runs.
  // Each match has either group 1 (code block content) or group 2 (text).
  const TOKEN_RE = /\{([^}]*)\}|([^{]+)/g;
  let clearScreen = false;

  const chunks: Uint8Array[] = [];
  const pushText = (s: string) =>
    chunks.push(Uint8Array.from(s, (c) => c.charCodeAt(0)));

  for (const match of codes.matchAll(TOKEN_RE)) {
    const codeBlock = match[1];
    const text = match[2];

    if (text !== undefined) {
      // Plain text — append as-is (printable chars ≥ 0x20 pass straight through).
      pushText(text);
      incrementCursor(session, text.length);
      continue;
    }

    // Code block: trim whitespace and check for function-call form.
    const token = codeBlock.trim();
    const parenIdx = token.indexOf("(");

    if (parenIdx === -1) {
      // Simple named code: look up in characterCodes.
      const bytes = characterCodes[token as keyof typeof characterCodes];
      if (bytes !== undefined) {
        chunks.push(bytes);
        incrementCursor(session, 1);
      } else {
        console.warn(`parseCodes: unknown code "${token}"`);
      }
    } else {
      // Function-call form: name(arg1, arg2, ...)
      const name = token.slice(0, parenIdx).trim();
      const argsStr = token.slice(parenIdx + 1, token.lastIndexOf(")")).trim();
      const args = argsStr.split(",").map((a) => parseInt(a.trim(), 10));

      switch (name) {
        case "clear":
          // EscClear must always be the very first byte in the output.
          chunks.unshift(noEscCodes.EscHome);
          chunks.unshift(noEscCodes.EscClear);
          clearScreen = true;
          session.cursor = [0, 0];
          break;
        case "go":
          const row = args[0] ?? 0;
          const col = args[1] ?? 0;
          if (session.type == "viewdata") {
            // Jump to (0,0) then advance by row line-feeds and col spaces.
            chunks.push(noEscCodes.EscHome);
            for (let r = 0; r < row; r++) chunks.push(noEscCodes.EscLf);
          }
          pushText(" ".repeat(col));
          session.cursor = [row, col];
          break;
        default:
          console.warn(`parseCodes: unknown function "${name}"`);
      }
    }
  }

  const totalLen = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    data: out,
    clearScreen,
  };
};

const incrementCursor = (session: any, n: number) => {
  const totalCols = session.cursor[1] + n;
  const newCol = totalCols % CELLS_PER_ROW;
  const newRow =
    (session.cursor[0] + Math.floor(totalCols / CELLS_PER_ROW)) % TOTAL_ROWS;
  session.cursor = [newRow, newCol];
};
