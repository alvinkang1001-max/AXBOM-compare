const norm = (v) => String(v ?? "").replace(/\u00a0/g, " ").trim();
const normUpper = (v) => norm(v).toUpperCase();
const normHeader = (v) => normUpper(v).replace(/[\s_.()\-/#]/g, "");

const ALIASES = {
  action: ["ACTION", "動作", "異動", "變更"],
  scope: ["位階", "階層", "LEVEL", "SCOPE"],
  refDes: ["插件位置", "插件位號", "位號", "REFDES", "REFERENCEDESIGNATOR", "BOMREFDES"],
  partNumber: ["料號", "PARTNUMBER", "PARTNO", "PN", "ITEMNUMBER", "BOMPARTNUMBER"],
  description: ["品名", "DESCRIPTION", "ITEMDESCRIPTION", "BOMITEMDESCRIPTION"],
  qty: ["數量", "QTY", "QUANTITY", "BOMQTY"],
  findNum: ["FINDNUM", "BOMFINDNUM"],
  itemRev: ["ITEMREV", "BOMITEMREV"],
  lifecycle: ["LIFECYCLEPHASE", "ITEMLIFECYCLEPHASE"],
  firmwareVersion: ["FIRMWAREVERSION", "FWVERSION"]
};

const ACTION_WORDS = {
  ADD: ["新增", "ADD", "INSERT", "NEW"],
  DELETE: ["刪除", "删除", "DELETE", "DEL", "REMOVE"]
};

function headerMatches(value, key) {
  const h = normHeader(value);
  if (!h) return false;
  return ALIASES[key].some((a) => h === normHeader(a) || h.endsWith(normHeader(a)));
}

function classifyAction(value) {
  const x = normUpper(value);
  for (const [action, words] of Object.entries(ACTION_WORDS)) {
    if (words.some((w) => x === normUpper(w) || x.includes(normUpper(w)))) return action;
  }
  return null;
}

export function normalizePartNumber(value) {
  const s = norm(value);
  if (!s) return "";
  if (/^\d+(\.0+)?$/.test(s)) return s.replace(/\.0+$/, "");
  return s.replace(/\s+/g, "").toUpperCase();
}

function expandRefRange(token) {
  const m = /^([A-Z]+)(\d+)-\1?(\d+)$/i.exec(token);
  if (!m) return [token];
  const [, prefix, aStr, bStr] = m;
  const a = Number(aStr), b = Number(bStr);
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < a || b - a > 500) return [token];
  return Array.from({ length: b - a + 1 }, (_, i) => `${prefix.toUpperCase()}${a + i}`);
}

export function splitRefDes(value) {
  const s = normUpper(value).replace(/[，、；]/g, ",").replace(/\s*[,;\n\r]+\s*/g, ",");
  if (!s) return [];
  const raw = s.split(",").flatMap((x) => x.trim().split(/\s+/)).filter(Boolean);
  return [...new Set(raw.flatMap(expandRefRange))];
}

export function deriveScope(partNumber, pattern = /^(8[A-Z])/i) {
  const pn = normalizePartNumber(partNumber);
  const m = pattern.exec(pn);
  return m ? m[1].toUpperCase() : "";
}

function findColumnMap(row, start = 0, end = row.length) {
  const map = {};
  for (let c = start; c < end; c++) {
    for (const key of Object.keys(ALIASES)) {
      if (map[key] == null && headerMatches(row[c], key)) map[key] = c;
    }
  }
  return map;
}

function rowBlankInColumns(row, cols) { return cols.every((c) => !norm(row[c])); }

function findNextActionAnchor(row, afterCol) {
  for (let c = afterCol + 1; c < row.length; c++) if (classifyAction(row[c])) return c;
  return row.length;
}

export function parseRdMatrices(sheets) {
  const changes = [], diagnostics = [];
  for (const { name, rows } of sheets) {
    if (!Array.isArray(rows)) continue;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const action = classifyAction(row[c]);
        if (!action) continue;
        const blockEnd = findNextActionAnchor(row, c);
        let headerRow = -1, colMap = null;
        for (let rr = r; rr <= Math.min(r + 3, rows.length - 1); rr++) {
          const m = findColumnMap(rows[rr] || [], c, blockEnd);
          if (m.partNumber != null && (m.refDes != null || m.qty != null)) { headerRow = rr; colMap = m; break; }
        }
        if (headerRow < 0) {
          diagnostics.push(`${name}: found ${action} at R${r + 1}C${c + 1}, but no nearby header was recognized.`);
          continue;
        }
        const relevantCols = Object.values(colMap);
        let blankRun = 0;
        for (let rr = headerRow + 1; rr < rows.length; rr++) {
          const dataRow = rows[rr] || [];
          if (rowBlankInColumns(dataRow, relevantCols)) {
            blankRun++;
            if (blankRun >= 2) break;
            continue;
          }
          blankRun = 0;
          if (classifyAction(dataRow[c])) break;
          const pn = normalizePartNumber(dataRow[colMap.partNumber]);
          const refs = colMap.refDes != null ? splitRefDes(dataRow[colMap.refDes]) : [];
          const scopeRaw = colMap.scope != null ? normUpper(dataRow[colMap.scope]) : "";
          const scope = scopeRaw || deriveScope(pn);
          const qtyRaw = colMap.qty != null ? norm(dataRow[colMap.qty]) : "";
          const qty = qtyRaw === "" || Number.isNaN(Number(qtyRaw)) ? null : Number(qtyRaw);
          const description = colMap.description != null ? norm(dataRow[colMap.description]) : "";
          if (!pn && refs.length === 0) continue;
          changes.push({ sourceSheet:name, sourceRow:rr+1, action, scope, refDes:refs, partNumber:pn, description, qty });
        }
      }
    }
  }
  const seen = new Set(), unique = [];
  for (const x of changes) {
    const k = [x.action,x.scope,x.partNumber,[...x.refDes].sort().join(","),x.qty].join("|");
    if (!seen.has(k)) { seen.add(k); unique.push(x); }
  }
  return { changes: unique, diagnostics };
}

function scorePartNumberColumn(rows, headerRow, col, refCol) {
  let score = 0, seen = 0;
  for (let r = headerRow + 1; r < Math.min(rows.length, headerRow + 250); r++) {
    if (!splitRefDes(rows[r]?.[refCol]).length) continue;
    const v = normalizePartNumber(rows[r]?.[col]);
    if (!v) continue;
    seen++;
    if (/^[A-Z0-9_.\-]{5,24}$/.test(v) && !/\s/.test(v)) score += 2;
    if (/\d/.test(v)) score += 1;
  }
  return seen ? score / seen : 0;
}

export function parseAgileMatrices(sheets) {
  let best = null;
  for (const { name, rows } of sheets) {
    if (!Array.isArray(rows)) continue;
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const map = findColumnMap(rows[r] || []);
      if (map.refDes == null || map.qty == null) continue;
      const richness = Object.keys(map).length;
      if (!best || richness > best.richness) best = { name, rows, headerRow:r, map, richness };
    }
  }
  if (!best) throw new Error("Cannot recognize Agile header. Required columns: BOM.Ref Des and BOM.Qty.");

  const { name, rows, headerRow, map } = best;
  const header = rows[headerRow] || [];
  let parentCol = null;
  for (let c = 0; c < header.length; c++) {
    const h = normHeader(header[c]);
    if (h === "PARTNUMBER" || h === "PARTNO") { parentCol = c; break; }
  }
  let componentCol = null;
  for (let c = 0; c < header.length; c++) {
    const h = normHeader(header[c]);
    if (h.includes("BOM") && h.includes("PARTNUMBER")) { componentCol = c; break; }
  }
  if (componentCol == null) {
    let bestScore = -1;
    for (let c = 0; c < header.length; c++) {
      if (c === parentCol || c === map.refDes || c === map.qty || c === map.description) continue;
      const s = scorePartNumberColumn(rows, headerRow, c, map.refDes);
      if (s > bestScore) { bestScore = s; componentCol = c; }
    }
  }

  let parentPartNumber = "";
  if (parentCol != null) {
    for (let r = headerRow + 1; r < rows.length; r++) {
      const pn = normalizePartNumber(rows[r]?.[parentCol]);
      if (pn) { parentPartNumber = pn; break; }
    }
  }

  const lines = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const refs = splitRefDes(row[map.refDes]);
    if (!refs.length) continue;
    const pn = normalizePartNumber(row[componentCol]);
    if (!pn) continue;
    const qtyRaw = norm(row[map.qty]);
    const qty = qtyRaw === "" || Number.isNaN(Number(qtyRaw)) ? null : Number(qtyRaw);
    lines.push({
      sourceSheet:name, sourceRow:r+1, partNumber:pn, refDes:refs, qty,
      description: map.description != null ? norm(row[map.description]) : "",
      findNum: map.findNum != null ? norm(row[map.findNum]) : "",
      itemRev: map.itemRev != null ? norm(row[map.itemRev]) : "",
      lifecycle: map.lifecycle != null ? norm(row[map.lifecycle]) : "",
      firmwareVersion: map.firmwareVersion != null ? norm(row[map.firmwareVersion]) : ""
    });
  }
  return { parentPartNumber, scope:deriveScope(parentPartNumber), lines, diagnostics:componentCol == null ? ["Component Part Number column could not be recognized."] : [] };
}

function makeAgileIndex(lines) {
  const byRef = new Map();
  for (const line of lines) for (const ref of line.refDes) {
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref).push(line);
  }
  return byRef;
}

function canonicalRefs(refs) { return [...refs].sort().join(","); }

export function compareBom(rdChanges, agile, options = {}) {
  const scope = normUpper(options.scope || agile.scope);
  const index = makeAgileIndex(agile.lines || []);
  const results = [];
  for (const ch of rdChanges) {
    const rdScope = normUpper(ch.scope), refs = ch.refDes || [];
    const base = { action:ch.action, scope:rdScope, refDes:canonicalRefs(refs), rdPartNumber:ch.partNumber, rdQty:ch.qty, description:ch.description, sourceSheet:ch.sourceSheet, sourceRow:ch.sourceRow };
    if (scope && rdScope && scope !== rdScope) {
      results.push({ ...base, status:"OUT_OF_SCOPE", agilePartNumber:"", note:`Target scope is ${scope}.` }); continue;
    }
    if (!refs.length) {
      results.push({ ...base, status:"WARNING", agilePartNumber:"", note:"RD row has no Ref Des; cannot perform Ref Des centric verification." }); continue;
    }
    const matchedLines = refs.flatMap((ref) => index.get(ref) || []);
    const actualPns = [...new Set(matchedLines.map((x) => x.partNumber))];
    if (ch.action === "ADD") {
      const missingRefs = [], wrongRefs = [];
      for (const ref of refs) {
        const atRef = index.get(ref) || [];
        if (!atRef.length) missingRefs.push(ref);
        else if (!atRef.some((x) => x.partNumber === ch.partNumber)) wrongRefs.push(ref);
      }
      if (missingRefs.length || wrongRefs.length) {
        const notes = [];
        if (missingRefs.length) notes.push(`Missing Ref Des: ${missingRefs.join(", ")}`);
        if (wrongRefs.length) notes.push(`Wrong Part at: ${wrongRefs.join(", ")}`);
        results.push({ ...base, status:"FAIL", agilePartNumber:actualPns.join(", "), note:notes.join("; ") }); continue;
      }
      let status="PASS", note="Part Number and Ref Des match.";
      const candidateRows = [...new Set(matchedLines.filter((x) => x.partNumber === ch.partNumber))];
      if (ch.qty != null) {
        const agileQtyValues = [...new Set(candidateRows.map((x) => x.qty).filter((x) => x != null))];
        if (agileQtyValues.length && !agileQtyValues.includes(ch.qty)) { status="WARNING"; note=`Part/Ref match, but Qty differs. RD=${ch.qty}, Agile=${agileQtyValues.join("/")}.`; }
      }
      results.push({ ...base, status, agilePartNumber:ch.partNumber, note });
    } else if (ch.action === "DELETE") {
      const stillPresent = [];
      for (const ref of refs) {
        const atRef = index.get(ref) || [];
        if (atRef.some((x) => x.partNumber === ch.partNumber)) stillPresent.push(ref);
      }
      if (stillPresent.length) results.push({ ...base, status:"FAIL", agilePartNumber:ch.partNumber, note:`Old part still exists at: ${stillPresent.join(", ")}` });
      else results.push({ ...base, status:"PASS", agilePartNumber:actualPns.join(", "), note:actualPns.length ? "Old part removed; Ref Des now contains another part (replacement)." : "Old part removed." });
    } else results.push({ ...base, status:"WARNING", agilePartNumber:actualPns.join(", "), note:`Unsupported RD action: ${ch.action}` });
  }
  const summary = results.reduce((acc,x)=>{ acc[x.status]=(acc[x.status]||0)+1; acc.TOTAL++; return acc; }, {TOTAL:0,PASS:0,FAIL:0,WARNING:0,OUT_OF_SCOPE:0});
  return { scope, results, summary };
}
