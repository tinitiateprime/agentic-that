import assert from "node:assert/strict";
import test from "node:test";
import { readAnalyticsExport } from "./parse-export.js";
import { parseXls, sniffSpreadsheet } from "./parse-xls.js";

// ── A tiny Excel 97-2003 writer, just enough to build test files ──────────

const u16 = (value) => [value & 0xff, (value >> 8) & 0xff];
const u32 = (value) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
const f64 = (value) => { const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value, true); return [...new Uint8Array(view.buffer)]; };
const record = (type, data) => [...u16(type), ...u16(data.length), ...data];
const latin = (text) => [...text].map((char) => char.charCodeAt(0));
const wide = (text) => [...text].flatMap((char) => u16(char.charCodeAt(0)));
const bof = (kind) => record(0x0809, [...u16(0x0600), ...u16(kind), ...Array(12).fill(0)]);
const eof = () => record(0x000a, []);

// Shared strings; the last one is split across a CONTINUE record that
// switches it from 1-byte to 2-byte characters.
function sst(strings, split) {
  const body = [...u32(strings.length), ...u32(strings.length)];
  for (const text of strings.slice(0, -1)) body.push(...u16(text.length), 0, ...latin(text));
  const last = strings.at(-1);
  body.push(...u16(last.length), 0, ...latin(last.slice(0, split)));
  return [...record(0x00fc, body), ...record(0x003c, [1, ...wide(last.slice(split))])];
}
const labelSst = (row, column, index) => record(0x00fd, [...u16(row), ...u16(column), ...u16(0), ...u32(index)]);
const number = (row, column, value) => record(0x0203, [...u16(row), ...u16(column), ...u16(0), ...f64(value)]);
const rk = (row, column, integer) => record(0x027e, [...u16(row), ...u16(column), ...u16(0), ...u32((integer << 2) | 0x02)]);
const mulrk = (row, first, integers) => record(0x00bd, [...u16(row), ...u16(first), ...integers.flatMap((value) => [...u16(0), ...u32((value << 2) | 0x02)]), ...u16(first + integers.length - 1)]);
const label = (row, column, text) => record(0x0204, [...u16(row), ...u16(column), ...u16(0), ...u16(text.length), 0, ...latin(text)]);

// Wraps a workbook stream in a compound file. Streams under 4096 bytes go in
// the mini stream, as Excel does, so both paths are exercised.
function compoundFile(stream, { mini = false } = {}) {
  const sector = 512;
  const pad = (bytes, size) => [...bytes, ...Array((size - (bytes.length % size)) % size).fill(0)];
  const FREE = 0xffffffff, END = 0xfffffffe, FATSECT = 0xfffffffd;
  const body = mini ? pad(stream, 64) : pad(stream.length < 4096 ? [...stream, ...Array(4096 - stream.length).fill(0)] : stream, sector);
  const bodySectors = body.length / sector + (mini ? (body.length % sector ? 1 : 0) : 0);
  const paddedBody = pad(body, sector);
  const dataSectors = paddedBody.length / sector;
  // Layout: 0 FAT, 1 directory, 2 mini FAT (when mini), then the data.
  const first = mini ? 3 : 2;
  const fat = Array(sector / 4).fill(FREE);
  fat[0] = FATSECT; fat[1] = END;
  if (mini) fat[2] = END;
  for (let index = 0; index < dataSectors; index += 1) fat[first + index] = index === dataSectors - 1 ? END : first + index + 1;
  const miniFat = Array(sector / 4).fill(FREE);
  const miniCount = body.length / 64;
  for (let index = 0; index < miniCount; index += 1) miniFat[index] = index === miniCount - 1 ? END : index + 1;

  const entry = (name, type, start, size) => {
    const bytes = Array(128).fill(0);
    wide(name).forEach((value, index) => { bytes[index] = value; });
    bytes.splice(0x40, 2, ...u16((name.length + 1) * 2));
    bytes[0x42] = type;
    bytes.splice(0x44, 12, ...u32(FREE), ...u32(FREE), ...u32(type === 5 ? 1 : FREE));
    bytes.splice(0x74, 8, ...u32(start), ...u32(size));
    return bytes;
  };
  const directory = [
    ...entry("Root Entry", 5, mini ? first : END, mini ? body.length : 0),
    ...entry("Workbook", 2, mini ? 0 : first, mini ? stream.length : Math.max(stream.length, 4096)),
    ...Array(256).fill(0),
  ];
  const header = Array(512).fill(0);
  header.splice(0, 8, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  header.splice(0x18, 8, ...u16(0x3e), ...u16(3), ...u16(0xfffe), ...u16(9));
  header.splice(0x20, 2, ...u16(6));
  header.splice(0x2c, 8, ...u32(1), ...u32(1));
  header.splice(0x38, 16, ...u32(4096), ...u32(mini ? 2 : END), ...u32(mini ? 1 : 0), ...u32(END));
  header.splice(0x48, 4, ...u32(0));
  for (let index = 0; index < 109; index += 1) header.splice(0x4c + index * 4, 4, ...u32(index === 0 ? 0 : FREE));
  void bodySectors;
  return new Uint8Array([
    ...header,
    ...fat.flatMap(u32),
    ...directory,
    ...(mini ? miniFat.flatMap(u32) : []),
    ...paddedBody,
  ]);
}

function linkedInWorkbook() {
  const strings = ["Update title", "Update link", "Created date", "Impressions", "Clicks", "Reactions", "Comments", "Reposts", "Launch day", "https://www.linkedin.com/feed/update/urn:li:activity:1", "Hiring now, join the team"];
  return [
    ...bof(0x0005),
    ...sst(strings, 10),
    ...eof(),
    ...bof(0x0010),
    ...label(0, 0, "Content metrics for Tinitiate"),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((column) => labelSst(1, column, column)).flat(),
    ...labelSst(2, 0, 8), ...labelSst(2, 1, 9), ...number(2, 2, 45567.5),
    ...mulrk(2, 3, [1200, 34, 56]), ...rk(2, 6, 7), ...rk(2, 7, 3),
    ...labelSst(3, 0, 10), ...label(3, 1, "https://www.linkedin.com/feed/update/urn:li:activity:2"), ...number(3, 2, 45568.25),
    ...number(3, 3, 800), ...number(3, 4, 12.5),
    ...eof(),
  ];
}

test("reads a real Excel 97-2003 .xls: shared strings split across records, numbers, RK and MULRK cells", () => {
  const sheets = parseXls(compoundFile(linkedInWorkbook()));
  assert.equal(sheets.length, 1);
  const [rows] = sheets;
  assert.equal(rows[0][0], "Content metrics for Tinitiate");
  assert.deepEqual(rows[1].slice(0, 4), ["Update title", "Update link", "Created date", "Impressions"]);
  assert.deepEqual(rows[2], ["Launch day", "https://www.linkedin.com/feed/update/urn:li:activity:1", "45567.5", "1200", "34", "56", "7", "3"]);
  assert.equal(rows[3][0], "Hiring now, join the team");
  assert.equal(rows[3][4], "12.5");
});

test("reads small .xls files kept in the mini stream", () => {
  const small = [...bof(0x0005), ...sst(["Views", "Hello"], 3), ...eof(), ...bof(0x0010), ...labelSst(0, 0, 0), ...labelSst(1, 0, 1), ...eof()];
  assert.ok(small.length < 4096);
  const [rows] = parseXls(compoundFile(small, { mini: true }));
  assert.deepEqual(rows, [["Views"], ["Hello"]]);
});

test("LinkedIn's original .xls download imports like the .xlsx", async () => {
  const result = await readAnalyticsExport({ fileName: "tinitiate_content_1700000000.xls", bytes: compoundFile(linkedInWorkbook()) });
  assert.equal(result.platform, "linkedin");
  assert.equal(result.posts.length, 2);
  const [first, second] = result.posts;
  assert.equal(first.text, "Launch day");
  assert.equal(first.publishedAt, "2024-10-02T12:00:00.000Z");
  assert.deepEqual(first.metrics, { impressions: 1200, clicks: 34, likes: 56, comments: 7, shares: 3 });
  assert.equal(second.text, "Hiring now, join the team");
  assert.deepEqual(second.metrics, { impressions: 800, clicks: 12.5 });
});

test(".xls files that are really HTML, XML, .xlsx or text are read too", async () => {
  const html = new TextEncoder().encode('<html><body><table><tr><th>Update title</th><th>Update link</th><th>Impressions</th></tr><tr><td>Hello &amp; welcome</td><td>https://www.linkedin.com/feed/update/1</td><td>1,234</td></tr></table></body></html>');
  assert.equal(sniffSpreadsheet(html), "html");
  const fromHtml = await readAnalyticsExport({ fileName: "export.xls", bytes: html });
  assert.equal(fromHtml.posts[0].text, "Hello & welcome");
  assert.equal(fromHtml.posts[0].metrics.impressions, 1234);

  const xml = new TextEncoder().encode('<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Posts"><Table><Row><Cell><Data ss:Type="String">Update title</Data></Cell><Cell><Data ss:Type="String">Impressions</Data></Cell></Row><Row><Cell><Data ss:Type="String">Hi</Data></Cell><Cell ss:Index="2"><Data ss:Type="Number">42</Data></Cell></Row></Table></Worksheet></Workbook>');
  assert.equal(sniffSpreadsheet(xml), "xml");
  assert.deepEqual(parseXls(xml), [[["Update title", "Impressions"], ["Hi", "42"]]]);

  const tabs = new TextEncoder().encode("Update title\tUpdate link\tImpressions\nHi\thttps://www.linkedin.com/feed/update/9\t5\n");
  const fromText = await readAnalyticsExport({ fileName: "export.xls", bytes: tabs });
  assert.equal(fromText.platform, "linkedin");
  assert.equal(fromText.posts[0].metrics.impressions, 5);
});

test("a damaged or encrypted .xls gets a clear message", async () => {
  const broken = compoundFile(linkedInWorkbook()).slice(0, 700);
  await assert.rejects(readAnalyticsExport({ fileName: "broken.xls", bytes: broken }), /couldn't be read|cut short|damaged|no workbook/);
  const locked = compoundFile([...bof(0x0005), ...record(0x002f, [0, 0]), ...eof()]);
  await assert.rejects(readAnalyticsExport({ fileName: "locked.xls", bytes: locked }), /password-protected/);
});
