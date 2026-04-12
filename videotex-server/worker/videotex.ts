import { CELLS_PER_ROW } from "~lib/characterCodes";

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

