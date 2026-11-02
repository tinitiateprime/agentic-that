// Inspect ZIP directory sizes before a DOCX parser can decompress the package.
export function inspectDocxArchive(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65557);
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0)
    throw new Error(
      "This is not a readable DOCX document. Save it as .docx in Word and try again.",
    );
  const count = view.getUint16(end + 10, true);
  const start = view.getUint32(end + 16, true);
  if (
    !count ||
    count > 2000 ||
    start === 0xffffffff ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0
  )
    throw new Error(
      "This DOCX package is too large or uses an unsupported archive format.",
    );
  let offset = start;
  let total = 0;
  const names = new Set();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("This DOCX package is damaged.");
    const size = view.getUint32(offset + 24, true);
    const length = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    if (
      offset + 46 + length + extra + comment > end ||
      view.getUint16(offset + 8, true) & 1
    )
      throw new Error(
        "Encrypted or damaged Word packages are not supported. Use an unprotected .docx copy.",
      );
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + length),
    );
    if (
      names.has(name) ||
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\")
    )
      throw new Error("This Word package contains invalid file entries.");
    names.add(name);
    total += size;
    if (size > 25 * 1024 * 1024 || total > 100 * 1024 * 1024)
      throw new Error(
        "This Word document is too large after unpacking. Reduce its images or content and try again.",
      );
    offset += 46 + length + extra + comment;
  }
  if (
    !names.has("word/document.xml") ||
    !names.has("[Content_Types].xml") ||
    [...names].some((name) => /vbaProject|activeX\//i.test(name))
  )
    throw new Error(
      "Choose a standard .docx document without macros or ActiveX content.",
    );
  return { entries: count, unpackedBytes: total };
}
