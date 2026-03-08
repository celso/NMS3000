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

    while (col < 40 && i < bytes.length) {
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

export const videotexCodes = {
  AlphaRed: 0b0000001,
  AlphaGreen: 0b0000010,
  AlphaYellow: 0b0000011,
  AlphaBlue: 0b0000100,
  AlphaMagenta: 0b0000101,
  AlphaCyan: 0b0000110,
  AlphaWhite: 0b0000111,
  GraphicsRed: 0b0010001,
  GraphicsGreen: 0b0010010,
  GraphicsYellow: 0b0010011,
  GraphicsBlue: 0b0010100,
  GraphicsMagenta: 0b0010101,
  GraphicsCyan: 0b0010110,
  GraphicsWhite: 0b0010111,
  Flash: 0b0001000,
};

export const vtc = (): Record<keyof typeof videotexCodes, string> => {
  const r = {} as Record<keyof typeof videotexCodes, string>;
  for (const c of Object.keys(videotexCodes) as Array<
    keyof typeof videotexCodes
  >) {
    r[c] = String.fromCharCode(videotexCodes[c]);
  }
  return r;
};

const ROWS = 25;
const CELLS_PER_ROW = 40;

export const writeBytes = (
  screenBuffer: any,
  colNum: number,
  rowNum: number,
  byteRows: Array<string | Array<string>>,
) => {
  for (let r = rowNum, i = 0; r < ROWS && i < byteRows.length; r++, i++) {
    const original = screenBuffer.rows[r].split("");
    const row = Array.isArray(byteRows[i])
      ? (byteRows[i] as [])
          .map((x: string) => {
            return [...x.slice(0, CELLS_PER_ROW - colNum)];
          })
          .flat()
      : [...byteRows[i]].slice(0, CELLS_PER_ROW - colNum);
    for (let c = colNum, j = 0; c < CELLS_PER_ROW && j < row.length; c++, j++) {
      original[c] = row[j];
    }
    screenBuffer.rows[r] = original.join("");
  }
  console.log("new rows:");
  //console.log(rows);
};
