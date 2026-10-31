// A small .xlsx writer for exports people open in Excel, Numbers or Google Sheets: styled header rows, tinted data
// rows, frozen panes, filters, merged group headings and column widths. No dependency: an .xlsx is a zip of XML
// files, written here with node's zlib.
//
// Sheet model:
//   { name, tabColor?, columns: [{ header, width, headerStyle? }], groups?: [{ label, span, style }],
//     rows: [{ cells: [value], style, cellStyles?: { [columnIndex]: style } }], freeze?: { rows, columns },
//     filter?: boolean }
// Styles are names from the `styles` map given to buildXlsx (options above stylesXml).

import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Zips [{ name, data: string|Buffer }] with deflate. */
export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// Characters XML 1.0 cannot hold (control characters other than tab, newline and carriage return).
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
const escapeXml = (value) =>
  String(value)
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function columnLetter(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

// Style options: fill (hex), bold, color (hex), size (pt), wrap, align ('center' | 'right'), numFmt (e.g. '0.0'),
// border ('header': medium line under, 'row': thin light line under).
const BORDERS = { header: 1, row: 2 };
function stylesXml(styles) {
  const names = Object.keys(styles);
  const fills = [];
  const fonts = [];
  const xfs = [];
  const numFmts = [];
  for (const name of names) {
    const style = styles[name];
    let fill = 0;
    if (style.fill) {
      fills.push(
        `<fill><patternFill patternType="solid"><fgColor rgb="FF${style.fill}"/><bgColor indexed="64"/></patternFill></fill>`
      );
      fill = fills.length + 1; // after the two fills Excel requires
    }
    fonts.push(
      `<font>${style.bold ? '<b/>' : ''}<sz val="${style.size || 11}"/><color rgb="FF${style.color || '000000'}"/><name val="Calibri"/></font>`
    );
    const font = fonts.length; // after the default font
    const border = BORDERS[style.border] || 0;
    let numFmt = 0;
    if (style.numFmt) {
      if (!numFmts.includes(style.numFmt)) numFmts.push(style.numFmt);
      numFmt = 164 + numFmts.indexOf(style.numFmt); // custom formats start at 164
    }
    const alignment = `<alignment vertical="${style.align === 'center' ? 'center' : 'top'}"${style.align ? ` horizontal="${style.align}"` : ''}${style.wrap ? ' wrapText="1"' : ''}/>`;
    xfs.push(
      `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1"${numFmt ? ' applyNumberFormat="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''} applyAlignment="1">${alignment}</xf>`
    );
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((format, index) => `<numFmt numFmtId="${164 + index}" formatCode="${escapeXml(format)}"/>`).join('')}</numFmts>` : ''}
<fonts count="${fonts.length + 1}"><font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font>${fonts.join('')}</fonts>
<fills count="${fills.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fills.join('')}</fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="medium"><color rgb="FF7F7F7F"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function cellXml(ref, value, styleIndex) {
  const s = styleIndex ? ` s="${styleIndex}"` : '';
  if (value === null || value === undefined || value === '') return styleIndex ? `<c r="${ref}"${s}/>` : '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet, styleIndexOf) {
  const rowsXml = [];
  const merges = [];
  let rowNumber = 0;
  if (sheet.groups?.length) {
    rowNumber += 1;
    let column = 0;
    const cells = [];
    for (const group of sheet.groups) {
      const style = styleIndexOf(group.style);
      for (let offset = 0; offset < group.span; offset += 1)
        cells.push(cellXml(`${columnLetter(column + offset)}${rowNumber}`, offset ? '' : group.label, style));
      if (group.span > 1)
        merges.push(`${columnLetter(column)}${rowNumber}:${columnLetter(column + group.span - 1)}${rowNumber}`);
      column += group.span;
    }
    rowsXml.push(`<row r="${rowNumber}" ht="24" customHeight="1">${cells.join('')}</row>`);
  }
  rowNumber += 1;
  const headerRow = rowNumber;
  rowsXml.push(
    `<row r="${rowNumber}" ht="48" customHeight="1">${sheet.columns
      .map((column, index) =>
        cellXml(`${columnLetter(index)}${rowNumber}`, column.header, styleIndexOf(column.headerStyle))
      )
      .join('')}</row>`
  );
  for (const row of sheet.rows) {
    rowNumber += 1;
    const base = styleIndexOf(row.style);
    rowsXml.push(
      `<row r="${rowNumber}">${sheet.columns
        .map((_, index) =>
          cellXml(
            `${columnLetter(index)}${rowNumber}`,
            row.cells[index],
            row.cellStyles?.[index] ? styleIndexOf(row.cellStyles[index]) : base
          )
        )
        .join('')}</row>`
    );
  }
  const lastColumn = columnLetter(Math.max(0, sheet.columns.length - 1));
  const freezeRows = sheet.freeze?.rows ?? 0;
  const freezeColumns = sheet.freeze?.columns ?? 0;
  const pane =
    freezeRows || freezeColumns
      ? `<pane${freezeColumns ? ` xSplit="${freezeColumns}"` : ''}${freezeRows ? ` ySplit="${freezeRows}"` : ''} topLeftCell="${columnLetter(freezeColumns)}${freezeRows + 1}" activePane="${freezeRows && freezeColumns ? 'bottomRight' : freezeRows ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
      : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${sheet.tabColor ? `<sheetPr><tabColor rgb="FF${sheet.tabColor}"/></sheetPr>` : ''}
<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="16"/>
<cols>${sheet.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width || 14}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rowsXml.join('')}</sheetData>
${sheet.filter && sheet.rows.length ? `<autoFilter ref="A${headerRow}:${lastColumn}${rowNumber}"/>` : ''}
${merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''}
</worksheet>`;
}

/** A workbook (Buffer) from sheets and named styles. */
export function buildXlsx(sheets, styles = {}) {
  const names = Object.keys(styles);
  const styleIndexOf = (name) => (name && names.includes(name) ? names.indexOf(name) + 1 : 0);
  const sheetName = (name, index) =>
    escapeXml(
      String(name || `Sheet${index + 1}`)
        .slice(0, 31)
        .replace(/[\\/?*[\]:]/g, ' ')
    );
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${sheetName(sheet.name, index)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>${sheets.some((sheet) => sheet.filter && sheet.rows.length) ? `<definedNames>${sheets.map((sheet, index) => (sheet.filter && sheet.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">'${sheetName(sheet.name, index)}'!$A$${sheet.groups?.length ? 2 : 1}:$${columnLetter(sheet.columns.length - 1)}$${sheet.rows.length + (sheet.groups?.length ? 2 : 1)}</definedName>` : '')).join('')}</definedNames>` : ''}</workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    },
    { name: 'xl/styles.xml', data: stylesXml(styles) },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: sheetXml(sheet, styleIndexOf)
    }))
  ];
  return zip(files);
}
