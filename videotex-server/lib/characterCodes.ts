export const CELLS_PER_ROW = 40;
export const TOTAL_ROWS = 24;
/**
 * MR9735 Teletext Character Codes
 * Source: Fig.11 - Teletext character codes (002 character set)
 *
 * Bit layout: b6 b5 b4 b3 b2 b1
 * Codes 000000–001111 cover columns 0 and 1 of the character code table.
 * b5=0 → column 0 (alphanumeric/control), b5=1 → column 1 (graphics/control)
 *
 * Viewdata encoding: control codes (< 0x20) are ESC-encoded as two bytes: 1B XX
 * where XX = code + 0x40
 */
export const characterCodes = {
  // Column 0 (b5=0): rows 0–15
  Nul:              new Uint8Array([0x1b, 0x40]), // Row  0 - Null             (0x00)
  AlphaRed:         new Uint8Array([0x1b, 0x41]), // Row  1 - Alpha Red        (0x01)
  AlphaGreen:       new Uint8Array([0x1b, 0x42]), // Row  2 - Alpha Green      (0x02)
  AlphaYellow:      new Uint8Array([0x1b, 0x43]), // Row  3 - Alpha Yellow     (0x03)
  AlphaBlue:        new Uint8Array([0x1b, 0x44]), // Row  4 - Alpha Blue       (0x04)
  AlphaMagenta:     new Uint8Array([0x1b, 0x45]), // Row  5 - Alpha Magenta    (0x05)
  AlphaCyan:        new Uint8Array([0x1b, 0x46]), // Row  6 - Alpha Cyan       (0x06)
  AlphaWhite:       new Uint8Array([0x1b, 0x47]), // Row  7 - Alpha White      (0x07)
  Flash:            new Uint8Array([0x1b, 0x48]), // Row  8 - Flash            (0x08)
  Steady:           new Uint8Array([0x1b, 0x49]), // Row  9 - Steady           (0x09)
  EndBox:           new Uint8Array([0x1b, 0x4a]), // Row 10 - End Box          (0x0A)
  StartBox:         new Uint8Array([0x1b, 0x4b]), // Row 11 - Start Box        (0x0B)
  NormalHeight:     new Uint8Array([0x1b, 0x4c]), // Row 12 - Normal Height    (0x0C)
  DoubleHeight:     new Uint8Array([0x1b, 0x4d]), // Row 13 - Double Height    (0x0D)
  SpecialGraphics:  new Uint8Array([0x1b, 0x4e]), // Row 14 - Special Graphics (0x0E)
  NormalGraphics:   new Uint8Array([0x1b, 0x4f]), // Row 15 - Normal Graphics  (0x0F)

  // Column 1 (b5=1): rows 0–15
  Dle:                 new Uint8Array([0x1b, 0x50]), // Row  0 - Data Link Escape    (0x10)
  GraphicsRed:         new Uint8Array([0x1b, 0x51]), // Row  1 - Graphics Red        (0x11)
  GraphicsGreen:       new Uint8Array([0x1b, 0x52]), // Row  2 - Graphics Green      (0x12)
  GraphicsYellow:      new Uint8Array([0x1b, 0x53]), // Row  3 - Graphics Yellow     (0x13)
  GraphicsBlue:        new Uint8Array([0x1b, 0x54]), // Row  4 - Graphics Blue       (0x14)
  GraphicsMagenta:     new Uint8Array([0x1b, 0x55]), // Row  5 - Graphics Magenta    (0x15)
  GraphicsCyan:        new Uint8Array([0x1b, 0x56]), // Row  6 - Graphics Cyan       (0x16)
  GraphicsWhite:       new Uint8Array([0x1b, 0x57]), // Row  7 - Graphics White      (0x17)
  ConcealDisplay:      new Uint8Array([0x1b, 0x58]), // Row  8 - Conceal Display     (0x18)
  ContiguousGraphics:  new Uint8Array([0x1b, 0x59]), // Row  9 - Contiguous Graphics (0x19)
  SeparatedGraphics:   new Uint8Array([0x1b, 0x5a]), // Row 10 - Separated Graphics  (0x1A)
  Esc:                 new Uint8Array([0x1b, 0x5b]), // Row 11 - Escape              (0x1B)
  BlackBackground:     new Uint8Array([0x1b, 0x5c]), // Row 12 - Black Background    (0x1C)
  NewBackground:       new Uint8Array([0x1b, 0x5d]), // Row 13 - New Background      (0x1D)
  HoldGraphics:        new Uint8Array([0x1b, 0x5e]), // Row 14 - Hold Graphics       (0x1E)
  ReleaseGraphics:     new Uint8Array([0x1b, 0x5f]), // Row 15 - Release Graphics    (0x1F)
} as const;

export const noEscCodes = {
  // Cursor / terminal control (not ESC-encoded in the viewdata stream)
  EscClear: new Uint8Array([0x0c]), // Clears the screen and jumps to (0,0)
  EscCr:    new Uint8Array([0x0d]), // Carriage Return: jumps to the start of the current row
  EscLf:    new Uint8Array([0x0a]), // Line Feed: moves down to the next row
  EscLb:    new Uint8Array([0x0b]), // Line Back: moves up to the previous row
  EscHome:  new Uint8Array([0x1e]), // Jumps to (0,0)
} as const;


export type CharacterCodeKey = keyof typeof characterCodes;
