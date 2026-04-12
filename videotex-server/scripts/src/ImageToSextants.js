// SPDX-FileCopyrightText: 2021 Tech and Software Ltd.
// SPDX-License-Identifier: GPL-2.0-or-later
import sextantsToUnicode from './SextantsToUnicode.js'; 

export class ImageToSextants {
    // buffer is a 1-channel (greyscale) or 3-channel (RGB) raw image
    constructor(buffer, width, channels = 1) {
        this._buffer = buffer;
        this._widthPx = width;
        this._channels = channels;
        this._heightPx = buffer.length / (width * channels);

        if (!Number.isInteger(width))
            throw new Error('E9 ImageToSextants: width should be integer');
        if (!Number.isInteger(this._heightPx))
            throw new Error(`E11 ImageToSextants: bad width ${width} for buffer length ${buffer.length}`);

        this._numRows = Math.ceil(this._heightPx / 3);
        this._numCols = Math.ceil(this._widthPx / 2);
    }

    getSextants(col, row) {
        const xIdx = col * 2,
              yIdx = row * this._widthPx * 3,
              rootIndex = yIdx + xIdx;

        if (row >= this._numRows)
            throw new Error(`E25 ImageToSextants: row ${row} out of range for number of rows ${this._numRows}`);
        if (col >= this._numCols)
            throw new Error(`E27 ImageToSextants: col ${col} out of range for number of cols ${this._numCols}`);

        const result = [
            this._buffer[rootIndex],
            this._buffer[rootIndex + 1],
            this._buffer[rootIndex + this._widthPx],
            this._buffer[rootIndex + this._widthPx + 1],
            this._buffer[rootIndex + this._widthPx * 2],
            this._buffer[rootIndex + this._widthPx * 2 + 1]
        ];
        return result.map(p => p ?? 0);
    }

    getValueFromSextants(col, row) {
        const cells = this.getSextants(col, row);
        const isPixelOn = v => v > 127 ? 1 : 0;

        const val = isPixelOn(cells[0]) +
                    (isPixelOn(cells[1]) << 1) +
                    (isPixelOn(cells[2]) << 2) +
                    (isPixelOn(cells[3]) << 3) +
                    (isPixelOn(cells[4]) << 4) +
                    (isPixelOn(cells[5]) << 5);
        return val;
    }

    // response range is 0x20 to 0x3f and 0x60 to 0x7f
    getTeletextG1Char(col, row) {
        const value = this.getValueFromSextants(col, row);
        let result;
        if (value < 0x20)
            result = String.fromCharCode(value + 0x20)
        else
            result = String.fromCharCode(value + 0x40)

        return result;
    }

    getUnicodeChar(col, row) {
        const value = this.getValueFromSextants(col, row);
        // using a lookup as the mapping isn't a contiguous block
        return sextantsToUnicode[value];
    }

    getTeletextG1Rows(options) {
        let rows = [];
        for (let r = 0; r < this._numRows; r++) {
            const cols = [];
            for (let c = 0; c < this._numCols; c++) {
                cols.push(this.getTeletextG1Char(c, r));
            }
            rows.push(cols.join(''));
        }

        rows = _addColourAttributesToRows(rows, options);
        return rows;
    }

    // --- RGB colour support -------------------------------------------------

    // Read the 6 pixels of a 2x3 teletext cell from a 3-channel RGB buffer.
    // Returns an array of 6 {r, g, b} objects.
    getRGBSextants(col, row) {
        const stride = this._widthPx * this._channels; // bytes per pixel row
        const xBase = col * 2 * this._channels;        // byte offset of left column in row
        const yBase = row * stride * 3;                // byte offset of top pixel row for this teletext row

        const px = (dy, dx) => {
            const i = yBase + dy * stride + xBase + dx * this._channels;
            return {
                r: this._buffer[i]     ?? 0,
                g: this._buffer[i + 1] ?? 0,
                b: this._buffer[i + 2] ?? 0,
            };
        };

        return [
            px(0, 0), px(0, this._channels),
            px(1, 0), px(1, this._channels),
            px(2, 0), px(2, this._channels),
        ];
    }

    // Average RGB of the 6 pixels in a teletext cell.
    getAverageRGB(col, row) {
        const pixels = this.getRGBSextants(col, row);
        let r = 0, g = 0, b = 0;
        for (const p of pixels) { r += p.r; g += p.g; b += p.b; }
        const n = pixels.length;
        return { r: r / n, g: g / n, b: b / n };
    }

    // Find the nearest teletext foreground colour name for an average RGB.
    getNearestTeletextColor(r, g, b) {
        let best = null;
        let bestDist = Infinity;
        for (const { name, rgb } of TELETEXT_COLORS) {
            const dr = r - rgb[0], dg = g - rgb[1], db = b - rgb[2];
            const dist = dr * dr + dg * dg + db * db;
            if (dist < bestDist) { bestDist = dist; best = name; }
        }
        return best;
    }

    // Compute the 6-bit sextant value from an RGB cell by thresholding brightness.
    getColorValueFromRGBSextants(col, row) {
        const pixels = this.getRGBSextants(col, row);
        let val = 0;
        for (let i = 0; i < 6; i++) {
            const { r, g, b } = pixels[i];
            const brightness = (r + g + b) / 3;
            if (brightness > 127) val |= (1 << i);
        }
        return val;
    }

    // Build teletext rows with per-run colour attributes from a 3-channel RGB buffer.
    // Emits a graphics colour attribute only when the colour changes between cells.
    // Each row is padded to exactly 40 logical cells (attributes count as cells).
    getTeletextG1RowsColor() {
        const MAX_COLS = 40;
        const rows = [];

        for (let r = 0; r < this._numRows; r++) {
            // Build a plan: array of {color, char} for each mosaic column
            const cells = [];
            for (let c = 0; c < this._numCols; c++) {
                const avg = this.getAverageRGB(c, r);
                const color = this.getNearestTeletextColor(avg.r, avg.g, avg.b);
                const value = this.getColorValueFromRGBSextants(c, r);
                const char = value < 0x20
                    ? String.fromCharCode(value + 0x20)
                    : String.fromCharCode(value + 0x40);
                cells.push({ color, char });
            }

            // Encode with run-length colour attributes
            let rowStr = '';
            let logicalCols = 0;
            let currentColor = null;

            for (let c = 0; c < cells.length && logicalCols < MAX_COLS; c++) {
                const { color, char } = cells[c];

                if (color !== currentColor) {
                    // Emit attribute byte — it occupies this logical cell.
                    // The mosaic char for column c is sacrificed (lost cell),
                    // keeping all subsequent characters at their correct positions.
                    if (logicalCols >= MAX_COLS) break;
                    rowStr += ATTRIBUTES[color];
                    logicalCols++;
                    currentColor = color;
                    // Attribute consumed this column; skip the mosaic char for col c
                    continue;
                }

                rowStr += char;
                logicalCols++;
            }

            // Pad to exactly MAX_COLS with spaces if short
            while (logicalCols < MAX_COLS) {
                rowStr += ' ';
                logicalCols++;
            }

            rows.push(rowStr);
        }

        return rows;
    }

    // -------------------------------------------------------------------------

    get unicodeRows() {
        const rows = [];
        for (let r = 0; r < this._numRows; r++) {
            const cols = [];
            for (let c = 0; c < this._numCols; c++) {
                cols.push(this.getUnicodeChar(c, r));
            }
            rows.push(cols.join(''));
        }
        return rows;
    }

    get html() {
        let response = HTML_WRAP_HEAD;
        response += this.unicodeRows.join('\n');
        response += HTML_WRAP_FOOT;
        return response;
    }
}


function _addColourAttributesToRows(rows, options = {}) {
    let bg = options.background ?? null;
    let fg = options.foreground ?? null;
    if (bg && !(bg in ATTRIBUTES)) throw new Error(`E109 bad background: ${bg}`);
    if (fg && !(fg in ATTRIBUTES)) throw new Error(`E110 bad foreground: ${fg}`);

    if (bg == 'black') bg = null; // not using attributes for black bg as it's the page default
    if (bg && !fg) fg = 'white';

    if (fg || bg) {
        rows = rows.map(row => {
            let attributes = '';
            if (bg) attributes = ATTRIBUTES[bg] + ATTRIBUTES.newBackground;
            if (fg) attributes += ATTRIBUTES[fg];
            return attributes + row;
        });
    }
    return rows;
}

const ATTRIBUTES = {
    black:   "\x10",
    red:     "\x11",
    green:   "\x12",
    yellow:  "\x13",
    blue:    "\x14",
    magenta: "\x15",
    cyan:    "\x16",
    white:   "\x17",
    "newBackground": "\x1d"
};

// Teletext foreground palette (excluding black — black cells render as spaces).
// Each entry maps a colour name to its full-brightness RGB triple.
const TELETEXT_COLORS = [
    { name: 'red',     rgb: [255,   0,   0] },
    { name: 'green',   rgb: [  0, 255,   0] },
    { name: 'yellow',  rgb: [255, 255,   0] },
    { name: 'blue',    rgb: [  0,   0, 255] },
    { name: 'magenta', rgb: [255,   0, 255] },
    { name: 'cyan',    rgb: [  0, 255, 255] },
    { name: 'white',   rgb: [255, 255, 255] },
];

const HTML_WRAP_HEAD = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
body {
    background-color: black;
    color: white;
}
@font-face {
    font-family: 'Unscii';
    src: url('fonts/unscii-8.otf') format('opentype');
    -webkit-font-smoothing: none;
    font-smooth: never;
}
pre {
    font-size: 16px;
    font-family: Unscii;
    line-height: 16px;
}
</style></head><body><pre>`;

const HTML_WRAP_FOOT = `</pre></body></html>`;
