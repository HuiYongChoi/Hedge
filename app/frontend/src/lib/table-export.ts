// 표 데이터를 엑셀(.xlsx) 파일과 PDF(인쇄 → PDF 로 저장)로 내보낸다.
// 외부 라이브러리 없이 동작한다 — .xlsx 는 XML 몇 개를 압축 없는(STORE) zip 으로 묶은 것이고,
// PDF 는 브라우저 인쇄 창을 쓴다(한글 글꼴을 따로 넣지 않아도 그대로 나온다).

export type ExportColumnType = 'text' | 'number' | 'percent';

export interface ExportColumn {
  header: string;
  type?: ExportColumnType;
  /** 엑셀 열 너비(글자 수) */
  width?: number;
}

export type ExportCell = string | number | null | undefined;

export interface ExportTable {
  /** 시트 이름·문서 제목 */
  title: string;
  /** 표 위에 붙는 설명 한 줄(PDF) */
  subtitle?: string;
  columns: ExportColumn[];
  rows: ExportCell[][];
}

// ── XLSX ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 압축 없는 zip. 파일 이름·내용은 UTF-8. */
export function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // STORE
    local.setUint16(10, 0, true); // time
    local.setUint16(12, 0x21, true); // date 1980-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, file.data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); // central directory header
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, 0, true);
    entry.setUint16(14, 0x21, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, size, true);
    entry.setUint32(24, size, true);
    entry.setUint16(28, name.length, true);
    entry.setUint16(30, 0, true);
    entry.setUint16(32, 0, true);
    entry.setUint16(34, 0, true);
    entry.setUint16(36, 0, true);
    entry.setUint32(38, 0, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function escapeXml(value: string): string {
  return value
    // XML 1.0 에 쓸 수 없는 제어 문자는 뺀다(탭·줄바꿈은 둔다).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// 시트 이름은 31자 이하, : \ / ? * [ ] 를 쓸 수 없다.
function sheetName(title: string): string {
  return (title.replace(/[:\\/?*[\]]/g, ' ').trim() || 'Sheet1').slice(0, 31);
}

// 셀 서식 번호(styles.xml 의 cellXfs 순서): 0 기본, 1 머리글(굵게), 2 백분율, 3 숫자(#,##0.00)
const STYLE_HEADER = 1;
const STYLE_PERCENT = 2;
const STYLE_NUMBER = 3;

function cellXml(ref: string, value: ExportCell, type: ExportColumnType, header = false): string {
  if (header) {
    return `<c r="${ref}" t="inlineStr" s="${STYLE_HEADER}"><is><t>${escapeXml(String(value ?? ''))}</t></is></c>`;
  }
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value) && type !== 'text') {
    const style = type === 'percent' ? STYLE_PERCENT : STYLE_NUMBER;
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

export function buildXlsxBytes(table: ExportTable): Uint8Array {
  const encoder = new TextEncoder();
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const header = `<row r="1">${table.columns
    .map((col, i) => cellXml(`${columnLetter(i)}1`, col.header, 'text', true))
    .join('')}</row>`;
  const body = table.rows
    .map((row, r) => {
      const rowNum = r + 2;
      const cells = table.columns
        .map((col, i) => cellXml(`${columnLetter(i)}${rowNum}`, row[i], col.type ?? 'text'))
        .join('');
      return `<row r="${rowNum}">${cells}</row>`;
    })
    .join('');
  const cols = table.columns
    .map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${col.width ?? 14}" customWidth="1"/>`)
    .join('');
  const lastRef = `${columnLetter(Math.max(table.columns.length - 1, 0))}${table.rows.length + 1}`;

  const sheet =
    `${head}<worksheet xmlns="${ns}">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${header}${body}</sheetData>` +
    `<autoFilter ref="A1:${lastRef}"/></worksheet>`;

  const styles =
    `${head}<styleSheet xmlns="${ns}">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const workbook =
    `${head}<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>` +
    `<sheet name="${escapeXml(sheetName(table.title))}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const pkgRel = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const files = [
    {
      name: '[Content_Types].xml',
      xml:
        `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      name: '_rels/.rels',
      xml: `${head}<Relationships xmlns="${pkgRel}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    { name: 'xl/workbook.xml', xml: workbook },
    {
      name: 'xl/_rels/workbook.xml.rels',
      xml:
        `${head}<Relationships xmlns="${pkgRel}">` +
        `<Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: 'xl/styles.xml', xml: styles },
    { name: 'xl/worksheets/sheet1.xml', xml: sheet },
  ];
  return buildZip(files.map(f => ({ name: f.name, data: encoder.encode(f.xml) })));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadXlsx(table: ExportTable, filename: string): void {
  const bytes = buildXlsxBytes(table);
  // bytes 는 새로 만든 배열이라 buffer 전체가 곧 파일 내용이다.
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

// ── PDF(인쇄) ────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatForPrint(value: ExportCell, type: ExportColumnType): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (type === 'percent') return `${(value * 100).toFixed(1)}%`;
    if (type === 'number') return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return String(value);
}

export function buildPrintHtml(table: ExportTable, documentTitle: string): string {
  const head = table.columns.map(col => `<th>${escapeHtml(col.header)}</th>`).join('');
  const body = table.rows
    .map(row => `<tr>${table.columns
      .map((col, i) => {
        const type = col.type ?? 'text';
        return `<td class="${type === 'text' ? '' : 'num'}">${escapeHtml(formatForPrint(row[i], type))}</td>`;
      })
      .join('')}</tr>`)
    .join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(documentTitle)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif; color: #111; }
  h1 { font-size: 14px; margin: 0 0 2px; }
  p { font-size: 10px; margin: 0 0 8px; color: #555; }
  table { border-collapse: collapse; width: 100%; font-size: 8px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 2px 4px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
</style></head><body>
<h1>${escapeHtml(table.title)}</h1>
${table.subtitle ? `<p>${escapeHtml(table.subtitle)}</p>` : ''}
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;
}

/** 인쇄 창을 연다 — 대상에서 'PDF로 저장'을 고르면 PDF 파일이 된다. */
export function printTableAsPdf(table: ExportTable, documentTitle: string): void {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(buildPrintHtml(table, documentTitle));
  doc.close();
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener('afterprint', cleanup);
  // 글꼴·표가 그려진 뒤 인쇄한다.
  setTimeout(() => {
    win.focus();
    win.print();
    // afterprint 를 주지 않는 브라우저를 위해 넉넉히 뒤에 정리한다.
    setTimeout(() => frame.remove(), 60000);
  }, 250);
}

// ── 화면 그대로 PDF ──────────────────────────────────────────────────────────

/**
 * 화면의 한 영역을 보이는 모습 그대로(색·배지·구역) 인쇄 창으로 보낸다.
 * 영역을 복제해 숨은 iframe 에 넣고, 이 페이지의 스타일시트와 테마(클래스·CSS 변수)를 그대로 옮긴다.
 * - data-print-hide 가 붙은 요소(버튼 등)는 빼고, 접힌 <details> 는 펼쳐서 싣는다.
 * - 배경색이 빠지지 않도록 print-color-adjust: exact 를 건다.
 */
export function printElementAsPdf(element: HTMLElement, documentTitle: string, heading?: string): void {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }

  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-print-hide]').forEach(node => node.remove());
  clone.querySelectorAll('details').forEach(node => node.setAttribute('open', ''));
  clone.style.maxWidth = 'none';
  clone.style.height = 'auto';
  clone.style.overflow = 'visible';

  const root = document.documentElement;
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(documentTitle)}</title></head><body></body></html>`);
  doc.close();
  doc.documentElement.className = root.className;
  const rootStyle = root.getAttribute('style');
  if (rootStyle) doc.documentElement.setAttribute('style', rootStyle);
  doc.body.className = document.body.className;

  const pending: Promise<void>[] = [];
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => {
    const copy = node.cloneNode(true) as HTMLElement;
    if (copy instanceof HTMLLinkElement) {
      pending.push(new Promise(resolve => {
        copy.addEventListener('load', () => resolve());
        copy.addEventListener('error', () => resolve());
      }));
    }
    doc.head.appendChild(copy);
  });
  const printStyle = doc.createElement('style');
  printStyle.textContent = `
    @page { size: A4 landscape; margin: 10mm; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body { height: auto !important; overflow: visible !important; background: ${bodyBg} !important; }
    body { margin: 0; padding: 12px; }
    section, [data-print-row] { break-inside: avoid; }
    .print-heading { font-size: 12px; margin: 0 0 8px; opacity: .75; }
  `;
  doc.head.appendChild(printStyle);
  if (heading) {
    const h = doc.createElement('div');
    h.className = 'print-heading text-foreground';
    h.textContent = heading;
    doc.body.appendChild(h);
  }
  doc.body.appendChild(doc.importNode(clone, true));

  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener('afterprint', cleanup);
  // 스타일시트가 다 읽힌 뒤(최대 2초) 인쇄한다.
  const timeout = new Promise<void>(resolve => setTimeout(resolve, 2000));
  Promise.race([Promise.all(pending).then(() => undefined), timeout]).then(() => {
    setTimeout(() => {
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 60000);
    }, 200);
  });
}
