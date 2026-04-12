#!/usr/bin/env NODE_NO_WARNINGS=1 npx tsx

import sharp from "sharp";
import { writeFile } from "fs/promises";
import { dirname, join } from "path";
import { ImageToSextants } from "./src/ImageToSextants.js";
import { encodeViewdata } from "../worker/videotex";

// Teletext foreground palette (full-brightness RGB triples, same as ImageToSextants).
const PALETTE: [number, number, number][] = [
  [255, 0, 0], // red
  [0, 255, 0], // green
  [255, 255, 0], // yellow
  [0, 0, 255], // blue
  [255, 0, 255], // magenta
  [0, 255, 255], // cyan
  [255, 255, 255], // white
  [0, 0, 0], // black
];

/**
 * Snap every pixel in an RGB buffer to the nearest teletext palette colour.
 *
 * @param data   Raw RGB pixel buffer (3 bytes per pixel, no alpha).
 * @param width  Row width in pixels — used to reset the "current colour" at the
 *               start of each row (teletext foreground defaults to white per row).
 * @param inertia  Colour-change penalty in squared-RGB-distance units (same scale
 *               as the Euclidean distance metric; max possible distance is ~195075
 *               for black↔white).  When inertia > 0, a palette entry that differs
 *               from the current colour has `inertia` added to its distance before
 *               comparison, so a colour switch only happens when the new colour
 *               wins by more than the penalty.  inertia=0 restores the original
 *               nearest-colour behaviour.
 */
function snapToPalette(data: Buffer, width: number, inertia = 0): Buffer {
  const out = Buffer.allocUnsafe(data.length);
  // Teletext default foreground is white; reset at the start of every row.
  let curR = 255,
    curG = 255,
    curB = 255;

  for (let i = 0; i < data.length; i += 3) {
    // Reset current colour to white at the beginning of each row.
    const pixelIndex = i / 3;
    if (pixelIndex % width === 0) {
      curR = 255;
      curG = 255;
      curB = 255;
    }

    let bestDist = Infinity,
      bestR = 0,
      bestG = 0,
      bestB = 0;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    for (const [pr, pg, pb] of PALETTE) {
      let d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      // Add inertia penalty for any colour that differs from the current one.
      if (inertia > 0 && (pr !== curR || pg !== curG || pb !== curB))
        d += inertia;
      if (d < bestDist) {
        bestDist = d;
        bestR = pr;
        bestG = pg;
        bestB = pb;
      }
    }
    out[i] = bestR;
    out[i + 1] = bestG;
    out[i + 2] = bestB;
    curR = bestR;
    curG = bestG;
    curB = bestB;
  }
  return out;
}

async function go(filename: string, outfile: string, inertia: number) {
  try {
    const meta = await sharp(filename).metadata();
    const dir = dirname(filename);

    // Step 1: Squash horizontally by 8/9 to correct for teletext pixel aspect ratio.
    const squashed = await sharp(filename)
      .resize(Math.round((meta.width ?? 0) * (8 / 9)), meta.height, {
        fit: "fill",
      })
      .toBuffer();

    // Step 2: Cartoon / posterisation pre-processing.
    //   a) Median blur (radius 5) to merge fine detail into flat colour regions.
    //   b) Boost saturation so colours pull decisively toward palette primaries.
    //   c) Pixelate: shrink to 1/4 size (nearest-neighbour implied by kernel:nearest)
    //      then blow back up — creates large flat blobs with hard edges.
    //   d) Final resize to 78×75 px (39 cols × 2 px, 25 rows × 3 px).
    const FINAL_W = 39 * 2; // 78
    const FINAL_H = 75;
    const PIXEL_W = Math.round(FINAL_W / 4); // ~20
    const PIXEL_H = Math.round(FINAL_H / 4); // ~19

    const cartoon = await sharp(squashed)
      .median(1)
      .modulate({ saturation: 3 })
      .resize(PIXEL_W, PIXEL_H, {
        fit: "cover",
        position: "entropy",
        kernel: "nearest",
      })
      .resize(FINAL_W, FINAL_H, { fit: "fill", kernel: "nearest" })
      .flatten({ background: "#000000" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Debug: save cartoon intermediate as PNG next to the input file.
    await sharp(cartoon.data, {
      raw: {
        width: cartoon.info.width,
        height: cartoon.info.height,
        channels: cartoon.info.channels,
      },
    }).toFile("/tmp/cartoon.png");

    // Step 3: Snap every pixel to the nearest teletext palette colour.
    //         This gives perfectly flat colour regions so that the 2×3 block
    //         averaging in ImageToSextants is unambiguous.
    const snapped = snapToPalette(
      cartoon.data as Buffer,
      cartoon.info.width,
      inertia,
    );

    // Debug: save palette-snapped intermediate as PNG next to the input file.
    await sharp(snapped, {
      raw: {
        width: cartoon.info.width,
        height: cartoon.info.height,
        channels: cartoon.info.channels,
      },
    }).toFile("/tmp/snapped.png");

    // Step 4: Convert pixel grid to colour teletext G1 mosaic rows.
    const sextants = new ImageToSextants(
      snapped,
      cartoon.info.width,
      cartoon.info.channels,
    );
    const data = sextants.getTeletextG1RowsColor();

    // Step 5: Encode rows to viewdata binary and write.
    await writeFile("/tmp/data.json", JSON.stringify(data));
    await writeFile(outfile, encodeViewdata(data));
  } catch (e) {
    console.error(e);
    process.exitCode = 42;
  }
}

if (!process.argv[2] || !process.argv[3]) {
  console.error(
    "Missing arguments.\nUsage: convert.ts <input-image> <output-file> [--inertia=<number>]",
  );
  process.exitCode = 1;
} else {
  // Parse optional --inertia=<number> flag from remaining argv.
  const inertiaArg = process.argv
    .slice(4)
    .find((a) => a.startsWith("--inertia="));
  const inertia = inertiaArg ? Number(inertiaArg.split("=")[1]) : 0;
  go(process.argv[2], process.argv[3], inertia);
}
