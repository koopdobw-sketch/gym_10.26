// Minimaler XLSX-Leser/-Schreiber ohne externe Bibliotheken (läuft komplett offline).
(function () {
  'use strict';

  // ---------- ZIP ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Schreibt ein ZIP ohne Kompression (STORE) – Excel öffnet das problemlos.
  function zipStore(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buffer) {
    const u8 = new Uint8Array(buffer), dv = new DataView(buffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Keine gültige .xlsx-Datei');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder(), out = {};
    for (let i = 0; i < count; i++) {
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const raw = u8.subarray(start, start + csize);
      out[name] = { method, raw };
      p += 46 + nlen + xlen + clen;
    }
    return {
      names: Object.keys(out),
      async text(name) {
        const f = out[name];
        if (!f) return null;
        const data = f.method === 0 ? f.raw : await inflateRaw(f.raw);
        return dec.decode(data);
      }
    };
  }

  // ---------- Hilfen ----------
  function colName(i) { // 1 -> A
    let s = '';
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function colIndex(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
    return n;
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------- Lesen ----------
  // Liefert { Blattname: Map("row,col" -> Wert) }
  async function readWorkbook(buffer) {
    const zip = await unzip(buffer);
    const parser = new DOMParser();
    const xml = async n => { const t = await zip.text(n); return t ? parser.parseFromString(t, 'application/xml') : null; };
    const strings = [];
    const ssDoc = await xml('xl/sharedStrings.xml');
    if (ssDoc) for (const si of ssDoc.getElementsByTagName('si')) {
      strings.push(Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join(''));
    }
    const wb = await xml('xl/workbook.xml');
    const rels = await xml('xl/_rels/workbook.xml.rels');
    const relMap = {};
    for (const r of rels.getElementsByTagName('Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
    const sheets = {};
    for (const s of wb.getElementsByTagName('sheet')) {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = relMap[rid];
      if (!target) continue;
      target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
      const doc = await xml('xl/' + target);
      if (!doc) continue;
      const cells = new Map();
      for (const c of doc.getElementsByTagName('c')) {
        const m = /^([A-Z]+)(\d+)$/.exec(c.getAttribute('r') || '');
        if (!m) continue;
        const t = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0];
        let val;
        if (t === 's') val = v ? strings[+v.textContent] : undefined;
        else if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map(x => x.textContent).join('');
        else if (t === 'str') val = v ? v.textContent : undefined;
        else if (t === 'b') val = v ? v.textContent === '1' : undefined;
        else val = v && v.textContent !== '' ? Number(v.textContent) : undefined;
        if (val !== undefined && val !== '') cells.set(+m[2] + ',' + colIndex(m[1]), val);
      }
      sheets[s.getAttribute('name')] = cells;
    }
    return sheets;
  }

  // ---------- Schreiben ----------
  // sheets: [{ name, rows: Map(rowNr -> Map(colNr -> cell)), cols: [{min,max,width}] }]
  // cell: { v: number|string, f?: formula, s?: styleIdx }
  // Styles: 0 normal, 1 fett, 2 Sekunden, 3 Datum, 4 fett+grau Kopf
  function writeWorkbook(sheets) {
    const sheetXml = sh => {
      let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
      if (sh.freeze) x += '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" topLeftCell="B1" activePane="topRight" state="frozen"/></sheetView></sheetViews>';
      if (sh.cols && sh.cols.length) {
        x += '<cols>' + sh.cols.map(c => `<col min="${c.min}" max="${c.max}" width="${c.width}" customWidth="1"/>`).join('') + '</cols>';
      }
      x += '<sheetData>';
      const rowNrs = [...sh.rows.keys()].sort((a, b) => a - b);
      for (const r of rowNrs) {
        const row = sh.rows.get(r);
        x += `<row r="${r}">`;
        for (const c of [...row.keys()].sort((a, b) => a - b)) {
          const cell = row.get(c), ref = colName(c) + r, s = cell.s ? ` s="${cell.s}"` : '';
          if (cell.f) {
            x += `<c r="${ref}"${s}><f>${esc(cell.f)}</f>${cell.v !== undefined ? `<v>${cell.v}</v>` : ''}</c>`;
          } else if (typeof cell.v === 'number') {
            x += `<c r="${ref}"${s}><v>${cell.v}</v></c>`;
          } else {
            x += `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
          }
        }
        x += '</row>';
      }
      return x + '</sheetData></worksheet>';
    };
    const files = [
      { name: '[Content_Types].xml', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>' },
      { name: '_rels/.rels', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<numFmts count="2"><numFmt numFmtId="164" formatCode="0&quot; s&quot;"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/></numFmts>' +
        '<fonts count="3"><font><sz val="12"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF666666"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
    ];
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }));
    return zipStore(files);
  }

  window.XLSX_MINI = { readWorkbook, writeWorkbook, colName, colIndex };
})();
