#!/usr/bin/env NODE_NO_WARNINGS=1 npx tsx

import sharp from "sharp";
import { writeFile } from "fs/promises";
import { dirname, join } from "path";
import { ImageToSextants } from "./src/ImageToSextants.js";
import { encodeViewdata } from "../worker/videotex";

async function go(filename: string, outfile: string) {
  try {
    const meta = await sharp(filename).metadata();
    const dir = dirname(filename);

    // squash horizontally so displayed aspect ratio is correct
    const resized = await sharp(filename)
      .resize(Math.round(meta.width * (8 / 9)), meta.height, {
        fit: "fill",
      })
      .toBuffer();

    // Resize to available pixels and convert to 1-channel raw image.
    // With fit: 'cover', sharp scales proportionally and crops.
    // We will use 1 spacing attribute to set cyan graphics and
    // use the default page background, resulting in 39*2 pixels horizontally.
    const raw = await sharp(resized)
      .toColourspace("b-w")
      .resize(39 * 2, 75, {
        fit: "cover",
        position: "entropy",
      })
      .normalise()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const sextants = new ImageToSextants(raw.data, raw.info.width);
    const data = sextants.getTeletextG1Rows({
      foreground: "cyan",
    });

    // Step 5: Encode rows to viewdata binary and write.
    await writeFile(outfile, encodeViewdata(data));
  } catch (e) {
    console.error(e);
    process.exitCode = 42;
  }
}

if (!process.argv[2] || !process.argv[3]) {
  console.error(
    "Missing arguments.\nUsage: convert_bw.ts <input-image> <output-file>",
  );
  process.exitCode = 1;
} else {
  // Parse optional --inertia=<number> flag from remaining argv.
  go(process.argv[2], process.argv[3]);
}
