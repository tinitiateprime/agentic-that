// Reads a video's length from its MP4/MOV header without decoding the file.

import fs from "fs";

const CONTAINER_BOXES = new Set(["moov"]);

/** Length in seconds, or 0 when the file isn't an MP4/MOV the header can be read from. */
export function mp4DurationSeconds(filePath: string) {
  let handle: number | null = null;
  try {
    handle = fs.openSync(filePath, "r");
    const fileHandle = handle;
    const read = (position: number, length: number) => {
      const buffer = Buffer.alloc(length);
      return buffer.subarray(0, fs.readSync(fileHandle, buffer, 0, length, position));
    };
    const walk = (start: number, end: number): number => {
      let position = start;
      while (position + 8 <= end) {
        const header = read(position, 16);
        if (header.length < 8) return 0;
        const type = header.toString("latin1", 4, 8);
        let size = header.readUInt32BE(0);
        let headerSize = 8;
        if (size === 1) {
          if (header.length < 16) return 0;
          size = Number(header.readBigUInt64BE(8));
          headerSize = 16;
        } else if (size === 0) {
          size = end - position;
        }
        if (size < headerSize) return 0;
        if (type === "mvhd") {
          const body = read(position + headerSize, 32);
          if (body.length < 32) return 0;
          const longForm = body[0] === 1;
          const timescale = body.readUInt32BE(longForm ? 20 : 12);
          const duration = longForm ? Number(body.readBigUInt64BE(24)) : body.readUInt32BE(16);
          return timescale ? duration / timescale : 0;
        }
        if (CONTAINER_BOXES.has(type)) {
          const found = walk(position + headerSize, Math.min(end, position + size));
          if (found) return found;
        }
        position += size;
      }
      return 0;
    };
    return walk(0, fs.fstatSync(fileHandle).size);
  } catch {
    return 0;
  } finally {
    if (handle !== null) fs.closeSync(handle);
  }
}
