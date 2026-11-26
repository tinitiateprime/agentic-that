// Reads old Excel (.xls) files as rows of cell text, so LinkedIn's original
// download can be uploaded without re-saving it. A file named .xls is one of:
//   - a real Excel 97-2003 workbook (an OLE "compound file" holding BIFF8
//     records), read below without any library;
//   - an .xlsx renamed to .xls (a zip), handled by the caller;
//   - an HTML table or an Excel 2003 XML spreadsheet, which some sites
//     download under an .xls name.

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const MAX_SECTORS = 1 << 20; // guards against looping chains in a damaged file

export class XlsReadError extends Error {}

/** What kind of file the bytes really are, whatever the extension says. */
export function sniffSpreadsheet(bytes) {
  if (OLE_SIGNATURE.every((byte, index) => bytes[index] === byte)) return "ole";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";
  const head = decodeText(bytes.subarray(0, 2048)).replace(/^﻿/, "").trimStart().slice(0, 2048).toLowerCase();
  if (head.startsWith("<")) return /urn:schemas-microsoft-com:office:spreadsheet|<workbook/.test(head) ? "xml" : "html";
  return "text";
}

/** Text in UTF-8, or UTF-16 when the bytes say so. */
export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.includes("\u0000") ? new TextDecoder("utf-16le").decode(bytes) : text;
}

// ── Compound file (OLE2) ───────────────────────────────────────────────────

function readCompoundStream(bytes, wanted) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset) => view.getUint32(offset, true);
  const sectorSize = 1 << view.getUint16(0x1e, true);
  const miniSectorSize = 1 << view.getUint16(0x20, true);
  const miniCutoff = u32(0x38);
  const sectorOffset = (sector) => (sector + 1) * sectorSize;
  const sectorBytes = (sector) => {
    const start = sectorOffset(sector);
    if (start >= bytes.length) throw new XlsReadError("The .xls file is cut short.");
    return bytes.subarray(start, Math.min(start + sectorSize, bytes.length));
  };

  // The FAT's own sectors are listed in the header, then in DIFAT sectors.
  const fatSectors = [];
  for (let index = 0; index < 109; index += 1) {
    const sector = u32(0x4c + index * 4);
    if (sector < END_OF_CHAIN - 1) fatSectors.push(sector);
  }
  let difat = u32(0x44);
  for (let guard = 0; difat < END_OF_CHAIN - 1 && guard < MAX_SECTORS; guard += 1) {
    const start = sectorOffset(difat);
    const perSector = sectorSize / 4 - 1;
    for (let index = 0; index < perSector; index += 1) {
      const sector = u32(start + index * 4);
      if (sector < END_OF_CHAIN - 1) fatSectors.push(sector);
    }
    difat = u32(start + perSector * 4);
  }
  const fat = [];
  for (const sector of fatSectors) {
    const start = sectorOffset(sector);
    for (let offset = 0; offset < sectorSize && start + offset + 4 <= bytes.length; offset += 4) fat.push(u32(start + offset));
  }

  const chain = (first, table) => {
    const list = [];
    for (let sector = first; sector < END_OF_CHAIN - 1 && list.length < MAX_SECTORS; sector = table[sector]) {
      if (sector >= table.length) throw new XlsReadError("The .xls file is damaged.");
      list.push(sector);
    }
    return list;
  };
  const join = (parts, size) => {
    const out = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      if (at >= size) break;
      const piece = part.subarray(0, Math.min(part.length, size - at));
      out.set(piece, at);
      at += piece.length;
    }
    return out;
  };

  // Directory: 128-byte entries along the directory chain.
  const directorySectors = chain(u32(0x30), fat);
  const directory = join(directorySectors.map(sectorBytes), directorySectors.length * sectorSize);
  const entries = [];
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const nameLength = directory[offset + 0x40] | (directory[offset + 0x41] << 8);
    const type = directory[offset + 0x42];
    if (!type || nameLength < 2) continue;
    const name = new TextDecoder("utf-16le").decode(directory.subarray(offset, offset + nameLength - 2));
    const entryView = new DataView(directory.buffer, directory.byteOffset + offset, 128);
    entries.push({ name, type, start: entryView.getUint32(0x74, true), size: entryView.getUint32(0x78, true) });
  }

  const entry = entries.find((item) => item.type === 2 && wanted.includes(item.name));
  if (!entry) return null;
  if (entry.size >= miniCutoff) return join(chain(entry.start, fat).map(sectorBytes), entry.size);

  // Small streams live in the "mini stream", itself stored in the root entry.
  const root = entries.find((item) => item.type === 5);
  if (!root) throw new XlsReadError("The .xls file is damaged.");
  const miniStream = join(chain(root.start, fat).map(sectorBytes), root.size);
  const miniFatSectors = chain(u32(0x3c), fat);
  const miniFatBytes = join(miniFatSectors.map(sectorBytes), miniFatSectors.length * sectorSize);
  const miniFat = [];
  for (let offset = 0; offset + 4 <= miniFatBytes.length; offset += 4) {
    miniFat.push(miniFatBytes[offset] | (miniFatBytes[offset + 1] << 8) | (miniFatBytes[offset + 2] << 16) | (miniFatBytes[offset + 3] * 2 ** 24));
  }
  const parts = chain(entry.start, miniFat).map((sector) => miniStream.subarray(sector * miniSectorSize, (sector + 1) * miniSectorSize));
  return join(parts, entry.size);
}

// ── BIFF records ───────────────────────────────────────────────────────────

const RECORD = {
  BOF: 0x0809, EOF: 0x000a, SST: 0x00fc, CONTINUE: 0x003c, LABELSST: 0x00fd, LABEL: 0x0204,
  NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd, FORMULA: 0x0006, STRING: 0x0207, BOOLERR: 0x0205, FILEPASS: 0x002f,
};

function rkValue(rk) {
  let value;
  if (rk & 0x02) value = rk >> 2; // 30-bit signed integer
  else {
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setUint32(4, rk & 0xfffffffc, true);
    value = buffer.getFloat64(0, true);
  }
  return rk & 0x01 ? value / 100 : value;
}

const numberText = (value) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 1e10) / 1e10));

// Reads BIFF8 strings that may run across CONTINUE records: each new record
// in the middle of a string's characters starts with a fresh "high byte" flag.
class SegmentReader {
  constructor(segments) { this.segments = segments; this.index = 0; this.pos = 0; }
  get current() { return this.segments[this.index]; }
  ensure() {
    while (this.current && this.pos >= this.current.length) { this.index += 1; this.pos = 0; }
    if (!this.current) throw new XlsReadError("The .xls file's text table is cut short.");
  }
  byte() { this.ensure(); return this.current[this.pos++]; }
  u16() { return this.byte() | (this.byte() << 8); }
  u32() { return (this.byte() | (this.byte() << 8) | (this.byte() << 16)) + this.byte() * 2 ** 24; }
  skip(count) { for (let index = 0; index < count; index += 1) this.byte(); }
  chars(count, highByte) {
    let high = highByte;
    let text = "";
    for (let index = 0; index < count; index += 1) {
      if (this.pos >= this.current.length) { this.index += 1; this.pos = 0; this.ensure(); high = this.byte() & 0x01; }
      text += String.fromCharCode(high ? this.u16() : this.byte());
    }
    return text;
  }
  // XLUnicodeRichExtendedString
  string() {
    const count = this.u16();
    const flags = this.byte();
    const runs = flags & 0x08 ? this.u16() : 0;
    const extended = flags & 0x04 ? this.u32() : 0;
    const text = this.chars(count, flags & 0x01);
    this.skip(runs * 4 + extended);
    return text;
  }
}

function shortString(data, offset, biff8) {
  const count = data[offset] | (data[offset + 1] << 8);
  if (!biff8) return String.fromCharCode(...data.subarray(offset + 2, offset + 2 + count));
  const high = data[offset + 2] & 0x01;
  const start = offset + 3;
  let text = "";
  for (let index = 0; index < count; index += 1) {
    text += String.fromCharCode(high ? data[start + index * 2] | (data[start + index * 2 + 1] << 8) : data[start + index]);
  }
  return text;
}

function readBiff(stream) {
  const records = [];
  for (let offset = 0; offset + 4 <= stream.length;) {
    const type = stream[offset] | (stream[offset + 1] << 8);
    const length = stream[offset + 2] | (stream[offset + 3] << 8);
    records.push({ type, data: stream.subarray(offset + 4, offset + 4 + length) });
    offset += 4 + length;
  }

  const shared = [];
  const sheets = [];
  let sheet = null;
  let biff8 = true;
  let pendingFormula = null;
  const put = (row, column, value) => {
    if (!sheet) return;
    while (sheet.length <= row) sheet.push([]);
    const cells = sheet[row];
    while (cells.length < column) cells.push("");
    cells[column] = value;
  };

  for (let index = 0; index < records.length; index += 1) {
    const { type, data } = records[index];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const u16 = (offset) => view.getUint16(offset, true);
    switch (type) {
      case RECORD.BOF: {
        biff8 = data.length >= 2 && u16(0) === 0x0600;
        const kind = data.length >= 4 ? u16(2) : 0;
        if (kind === 0x0010) { sheet = []; sheets.push(sheet); } else sheet = null;
        break;
      }
      case RECORD.EOF: sheet = null; break;
      case RECORD.FILEPASS: throw new XlsReadError("This .xls file is password-protected. Remove the password, or save it as .xlsx, then upload it.");
      case RECORD.SST: {
        const segments = [data.subarray(8)];
        while (records[index + 1]?.type === RECORD.CONTINUE) segments.push(records[(index += 1)].data);
        const reader = new SegmentReader(segments);
        const unique = view.getUint32(4, true);
        for (let item = 0; item < unique; item += 1) shared.push(reader.string());
        break;
      }
      case RECORD.LABELSST: put(u16(0), u16(2), shared[view.getUint32(6, true)] ?? ""); break;
      case RECORD.LABEL: put(u16(0), u16(2), shortString(data, 6, biff8)); break;
      case RECORD.NUMBER: put(u16(0), u16(2), numberText(view.getFloat64(6, true))); break;
      case RECORD.RK: put(u16(0), u16(2), numberText(rkValue(view.getUint32(6, true)))); break;
      case RECORD.MULRK: {
        const row = u16(0);
        const first = u16(2);
        const count = (data.length - 6) / 6;
        for (let item = 0; item < count; item += 1) put(row, first + item, numberText(rkValue(view.getUint32(4 + item * 6 + 2, true))));
        break;
      }
      case RECORD.BOOLERR: put(u16(0), u16(2), data[7] ? "" : data[6] ? "TRUE" : "FALSE"); break;
      case RECORD.FORMULA: {
        const row = u16(0);
        const column = u16(2);
        if (u16(12) === 0xffff) {
          const kind = data[6];
          if (kind === 0) pendingFormula = { row, column }; // text result follows in a STRING record
          else if (kind === 1) put(row, column, data[8] ? "TRUE" : "FALSE");
        } else put(row, column, numberText(view.getFloat64(6, true)));
        break;
      }
      case RECORD.STRING:
        if (pendingFormula) {
          const segments = [data];
          while (records[index + 1]?.type === RECORD.CONTINUE) segments.push(records[(index += 1)].data);
          const reader = new SegmentReader(segments);
          const count = reader.u16();
          put(pendingFormula.row, pendingFormula.column, biff8 ? reader.chars(count, reader.byte() & 0x01) : reader.chars(count, 0));
          pendingFormula = null;
        }
        break;
      default:
    }
  }
  return sheets.map((rows) => rows.filter((row) => row.some((value) => String(value ?? "").trim())));
}

// ── HTML and XML spreadsheets saved as .xls ────────────────────────────────

const decodeEntities = (value) => String(value)
  .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;|&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&amp;/g, "&")
  .trim();

function htmlTables(text) {
  return [...text.matchAll(/<table[\s\S]*?<\/table>/gi)].map(([table]) =>
    [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
      .map(([row]) => [...row.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].flatMap(([, attributes, cell]) => {
        const span = Number(/colspan\s*=\s*["']?(\d+)/i.exec(attributes)?.[1] || 1);
        return [decodeEntities(cell), ...Array(Math.max(0, Math.min(span, 50) - 1)).fill("")];
      }))
      .filter((row) => row.some(Boolean)));
}

function xmlSpreadsheet(text) {
  return [...text.matchAll(/<(?:ss:)?Worksheet[\s\S]*?<\/(?:ss:)?Worksheet>/gi)].map(([sheet]) =>
    [...sheet.matchAll(/<(?:ss:)?Row[^>]*?(?:\/>|>([\s\S]*?)<\/(?:ss:)?Row>)/gi)].map(([, body = ""]) => {
      const row = [];
      for (const [, attributes, cell = ""] of body.matchAll(/<(?:ss:)?Cell([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/gi)) {
        const at = Number(/(?:ss:)?Index="(\d+)"/i.exec(attributes)?.[1] || 0);
        if (at) while (row.length < at - 1) row.push("");
        row.push(decodeEntities(/<(?:ss:)?Data[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(cell)?.[1] ?? ""));
      }
      return row;
    }).filter((row) => row.some(Boolean)));
}

/** Every sheet of an .xls file (binary, HTML or XML) as rows of cell text. */
export function parseXls(bytes) {
  const kind = sniffSpreadsheet(bytes);
  if (kind === "html") return htmlTables(decodeText(bytes));
  if (kind === "xml") return xmlSpreadsheet(decodeText(bytes));
  if (kind !== "ole") throw new XlsReadError("This .xls file couldn't be read. Open it in Excel or Google Sheets, save it as .xlsx or .csv, and upload that.");
  const stream = readCompoundStream(bytes, ["Workbook", "Book"]);
  if (!stream) throw new XlsReadError("This .xls file has no workbook inside. Save it as .xlsx or .csv, then upload that.");
  return readBiff(stream);
}
