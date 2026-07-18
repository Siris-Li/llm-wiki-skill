import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

export function pngNonBackgroundPixelCount(png, background) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "screenshot should be PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  assert.equal(bitDepth, 8, "pixel acceptance expects 8-bit PNG screenshots");
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(bytesPerPixel > 0, `pixel acceptance does not support PNG color type ${colorType}`);
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset];
    sourceOffset += 1;
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset + x];
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[rowOffset + x - stride] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[rowOffset + x - stride - bytesPerPixel] : 0;
      pixels[rowOffset + x] = unfilterPngByte(filter, raw, left, up, upperLeft);
    }
    sourceOffset += stride;
  }
  let count = 0;
  for (let index = 0; index < pixels.length; index += bytesPerPixel * 4) {
    if (
      Math.abs(pixels[index] - background[0]) > 2
      || Math.abs(pixels[index + 1] - background[1]) > 2
      || Math.abs(pixels[index + 2] - background[2]) > 2
    ) count += 1;
  }
  return count;
}

export async function sigmaCanvasNonBackgroundPixelCount(root, background = [1, 2, 3]) {
  const previousStyles = await root.evaluate((element) => {
    const overlay = element.querySelector(".sigma-global-overlay");
    const snapshot = {
      background: element.style.background,
      overlayVisibility: overlay?.style.visibility || "",
    };
    element.style.background = "rgb(1, 2, 3)";
    if (overlay) overlay.style.visibility = "hidden";
    return snapshot;
  });
  try {
    return pngNonBackgroundPixelCount(await root.screenshot({ type: "png" }), background);
  } finally {
    await root.evaluate((element, previous) => {
      const overlay = element.querySelector(".sigma-global-overlay");
      element.style.background = previous.background;
      if (overlay) overlay.style.visibility = previous.overlayVisibility;
    }, previousStyles);
  }
}

function unfilterPngByte(filter, raw, left, up, upperLeft) {
  if (filter === 0) return raw;
  if (filter === 1) return (raw + left) & 255;
  if (filter === 2) return (raw + up) & 255;
  if (filter === 3) return (raw + Math.floor((left + up) / 2)) & 255;
  if (filter === 4) return (raw + paeth(left, up, upperLeft)) & 255;
  throw new Error(`unsupported PNG filter ${filter}`);
}

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}
