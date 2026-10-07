import { parseRdMatrices, parseAgileMatrices, compareBom } from './src/compare-engine.js';

const $ = (id) => document.getElementById(id);
let lastComparison = null;

function workbookToSheets(buffer) {
  if (!window.XLSX) throw new Error('SheetJS library was not loaded.');
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false })
  }));
}

async function readFile(file) {
  if (!file) throw new Error('Please select both files.');
  return workbookToSheets(await file.arrayBuffer());
}

function badge(status) {
  const label = status.replaceAll('_', ' ');
  return `<span class="badge ${status.toLowerCase()}">${label}</span>`;
}

function renderSummary(cmp, agile, rdCount, diagnostics) {
  $('target').textContent = agile.parentPartNumber || 'Unknown';
  $('scope').textContent = cmp.scope || 'Unknown';
  $('rdCount').textContent = rdCount;
  for (const k of ['PASS','FAIL','WARNING','OUT_OF_SCOPE']) $(''+k.toLowerCase()).textContent = cmp.summary[k] || 0;
  $('diagnostics').textContent = diagnostics.filter(Boolean).join(' | ');
  $('summary').hidden = false;
}

function renderTable(results) {
  const filter = $('filter').value;
  const rows = filter === 'ALL' ? results : results.filter((x) => x.status === filter);
  $('tbody').innerHTML = rows.map((x, i) => `
    <tr>
      <td>${i + 1}</td><td>${badge(x.status)}</td><td>${x.action}</td><td>${x.scope || ''}</td>
      <td>${x.refDes || ''}</td><td class="mono">${x.rdPartNumber || ''}</td>
      <td class="mono">${x.agilePartNumber || ''}</td><td>${x.rdQty ?? ''}</td><td>${x.note || ''}</td>
    </tr>`).join('');
  $('resultPanel').hidden = false;
}

async function doCompare() {
  try {
    $('error').textContent = '';
    $('compareBtn').disabled = true;
    const [rdSheets, agileSheets] = await Promise.all([
      readFile($('rdFile').files[0]),
      readFile($('agileFile').files[0])
    ]);
    const rd = parseRdMatrices(rdSheets);
    if (!rd.changes.length) throw new Error('No RD Add/Delete records were recognized. Please check the RD Difference BOM layout.');
    const agile = parseAgileMatrices(agileSheets);
    if (!agile.lines.length) throw new Error('No Agile BOM component rows were recognized.');
    const cmp = compareBom(rd.changes, agile);
    lastComparison = { cmp, agile, rd };
    renderSummary(cmp, agile, rd.changes.length, [...rd.diagnostics, ...agile.diagnostics]);
    renderTable(cmp.results);
    $('exportBtn').disabled = false;
  } catch (e) {
    console.error(e);
    $('error').textContent = e?.message || String(e);
  } finally {
    $('compareBtn').disabled = false;
  }
}

function exportExcel() {
  if (!lastComparison) return;
  const { cmp, agile } = lastComparison;
  const summaryRows = [
    ['RD BOM Compare Tool', 'V0.1'],
    ['Agile Parent PN', agile.parentPartNumber],
    ['Scope', cmp.scope],
    ['Total RD Changes', cmp.summary.TOTAL],
    ['PASS', cmp.summary.PASS], ['FAIL', cmp.summary.FAIL],
    ['WARNING', cmp.summary.WARNING], ['OUT OF SCOPE', cmp.summary.OUT_OF_SCOPE]
  ];
  const resultRows = cmp.results.map((x, i) => ({
    No: i + 1, Status: x.status, Action: x.action, Scope: x.scope,
    'Ref Des': x.refDes, 'RD Part Number': x.rdPartNumber,
    'Agile Part Number': x.agilePartNumber, 'RD Qty': x.rdQty ?? '', Note: x.note,
    'RD Source': `${x.sourceSheet || ''}!${x.sourceRow || ''}`
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resultRows), 'Results');
  XLSX.writeFile(wb, `RD_BOM_Compare_${agile.parentPartNumber || 'result'}.xlsx`);
}

$('compareBtn').addEventListener('click', doCompare);
$('filter').addEventListener('change', () => lastComparison && renderTable(lastComparison.cmp.results));
$('exportBtn').addEventListener('click', exportExcel);
for (const id of ['rdFile','agileFile']) $(id).addEventListener('change', (e) => {
  e.target.closest('.filebox').querySelector('.filename').textContent = e.target.files[0]?.name || 'No file selected';
});
