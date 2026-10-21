/** Small dependency-free XLSX writer for a five-sheet GSC export.
 * Uses ZIP "store" entries and inline strings (no formulas/macros).
 */
type Cell = string | number;
type Sheet = { name: string; rows: Cell[][] };
const encoder = new TextEncoder();
function xmlEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function column(index: number): string {
  let n = index + 1;
  let output = "";
  while (n > 0) {
    n--;
    output = String.fromCharCode(65 + (n % 26)) + output;
    n = Math.floor(n / 26);
  }
  return output;
}
function xmlSheet(rows: Cell[][]): string {
  const body = rows
    .map((row, y) => {
      const cells = row
        .map((value, x) => {
          const addr = `${column(x)}${y + 1}`;
          if (typeof value === "number" && Number.isFinite(value)) {
            return `<c r="${addr}"><v>${value}</v></c>`;
          }
          // Inline strings keep URL/query text literal, preventing Excel formula injection.
          return `<c r="${addr}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
        })
        .join("");
      return `<row r="${y + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function le16(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >>> 8) & 255);
}
function le32(n: number): Uint8Array {
  return Uint8Array.of(
    n & 255,
    (n >>> 8) & 255,
    (n >>> 16) & 255,
    (n >>> 24) & 255,
  );
}
function join(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, a) => sum + a.length, 0));
  let pos = 0;
  for (const part of parts) {
    result.set(part, pos);
    pos += part.length;
  }
  return result;
}
function makeZip(files: { path: string; body: string }[]): Uint8Array {
  const entries: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let position = 0;
  for (const { path, body } of files) {
    const name = encoder.encode(path),
      payload = encoder.encode(body),
      crc = crc32(payload);
    const local = join([
      le32(0x04034b50),
      le16(20),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(crc),
      le32(payload.length),
      le32(payload.length),
      le16(name.length),
      le16(0),
      name,
      payload,
    ]);
    entries.push(local);
    directory.push(
      join([
        le32(0x02014b50),
        le16(20),
        le16(20),
        le16(0),
        le16(0),
        le16(0),
        le16(0),
        le32(crc),
        le32(payload.length),
        le32(payload.length),
        le16(name.length),
        le16(0),
        le16(0),
        le16(0),
        le16(0),
        le32(0),
        le32(position),
        name,
      ]),
    );
    position += local.length;
  }
  const central = join(directory);
  const end = join([
    le32(0x06054b50),
    le16(0),
    le16(0),
    le16(files.length),
    le16(files.length),
    le32(central.length),
    le32(position),
    le16(0),
  ]);
  return join([...entries, central, end]);
}
export function buildCategoryWorkbook(sheets: Sheet[]): Uint8Array {
  if (sheets.length !== 5) throw new Error("Expected five category worksheets");
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const relNs =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="${relNs}"><sheets>${sheets
    .map(
      (s, i) =>
        `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join("")}</sheets></workbook>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`;
  return makeZip([
    { path: "[Content_Types].xml", body: types },
    { path: "_rels/.rels", body: relationships },
    { path: "xl/workbook.xml", body: workbook },
    { path: "xl/_rels/workbook.xml.rels", body: workbookRelationships },
    ...sheets.map((sheet, i) => ({
      path: `xl/worksheets/sheet${i + 1}.xml`,
      body: xmlSheet(sheet.rows),
    })),
  ]);
}
