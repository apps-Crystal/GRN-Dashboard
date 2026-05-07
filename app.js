

--
/* ---------------------------------------------------------------------------
 * GRN Dashboard - Frontend
 *
 * 1. Deploy Code.gs as a Web App (see header of Code.gs).
 * 2. Paste the deployment URL (.../exec) below.
 * --------------------------------------------------------------------------- */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzARNcqI9kDplQYwbib3XFqTgk5XsJpqyRFn70FXgXNqUXdn7VY6Nph5C-fgYA6nZaCjA/exec';

/* ---------- State ---------- */
const state = {
  sites: [],
  summary: null,        // current site summary payload
  filteredPos: [],      // current PO list after text filter / sort
  sort: { key: 'PO_Date', dir: 'desc' },
  poTextFilter: ''
};

/* ---------- DOM refs ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  conn: $('connStatus'),
  refresh: $('refreshBtn'),
  siteInput: $('siteInput'),
  siteList: $('siteList'),
  fromDate: $('fromDate'),
  toDate: $('toDate'),
  sortBy: $('sortBy'),
  searchBtn: $('searchBtn'),
  clearBtn: $('clearBtn'),
  filterHint: $('filterHint'),
  kpiRow: $('kpiRow'),
  kpiSite: $('kpiSite'),
  kpiPo: $('kpiPo'),
  kpiGrn: $('kpiGrn'),
  kpiNonPo: $('kpiNonPo'),
  statusBar: $('statusBar'),
  resultsPanel: $('resultsPanel'),
  poTable: $('poTable'),
  poTbody: $('poTbody'),
  poEmpty: $('poEmpty'),
  poFilter: $('poFilter'),
  poCountBadge: $('poCountBadge'),
  nonPoPanel: $('nonPoPanel'),
  nonPoTbody: $('nonPoTbody'),
  nonPoBadge: $('nonPoBadge'),
  siteOverviewPanel: $('siteOverviewPanel'),
  siteOverviewName: $('siteOverviewName'),
  siteOverviewGrid: $('siteOverviewGrid'),
  allGrnPanel: $('allGrnPanel'),
  allGrnTbody: $('allGrnTbody'),
  allGrnBadge: $('allGrnBadge'),
  allGrnFilter: $('allGrnFilter'),
  detailPanel: $('detailPanel'),
  detailPoId: $('detailPoId'),
  detailGrid: $('detailGrid'),
  detailItemsTbody: $('detailItemsTbody'),
  closeDetail: $('closeDetailBtn'),
  grnDetailPanel: $('grnDetailPanel'),
  grnDetailId: $('grnDetailId'),
  grnDetailGrid: $('grnDetailGrid'),
  grnDetailItemsTbody: $('grnDetailItemsTbody'),
  closeGrnDetail: $('closeGrnDetailBtn'),
  lastSync: $('lastSync')
};

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === 0) {
    showStatus('Set APPS_SCRIPT_URL inside app.js to your deployed Web App URL.', 'error');
    setConn('Not configured', 'conn-error');
    return;
  }
  loadSites();
});

function bindEvents() {
  els.refresh.addEventListener('click', () => {
    loadSites();
    if (els.siteInput.value.trim()) runSearch();
  });
  els.searchBtn.addEventListener('click', runSearch);
  els.clearBtn.addEventListener('click', clearAll);
  els.siteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  els.fromDate.addEventListener('change', () => { if (state.summary) runSearch(); });
  els.toDate.addEventListener('change', () => { if (state.summary) runSearch(); });
  els.sortBy.addEventListener('change', () => { applySortAndRender(); });
  els.poFilter.addEventListener('input', (e) => {
    state.poTextFilter = e.target.value.trim().toLowerCase();
    applySortAndRender();
  });

  els.poTable.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.key = key;
        state.sort.dir = 'asc';
      }
      // sync the dropdown for clarity
      const dropdownVal = `${key}_${state.sort.dir}`;
      if ([...els.sortBy.options].some(o => o.value === dropdownVal)) {
        els.sortBy.value = dropdownVal;
      }
      applySortAndRender();
    });
  });

  els.closeDetail.addEventListener('click', () => {
    els.detailPanel.hidden = true;
  });
  els.closeGrnDetail.addEventListener('click', () => {
    els.grnDetailPanel.hidden = true;
  });

  // Delegated handler: every element with .grn-link or .grn-chip[data-grn] opens GRN detail
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-grn]');
    if (!t) return;
    const id = t.getAttribute('data-grn');
    if (id) loadGrnDetail(id);
  });

  // KPI card clicks
  document.querySelectorAll('.kpi-card[data-kpi]').forEach(card => {
    card.addEventListener('click', () => handleKpiClick(card.getAttribute('data-kpi')));
  });

  // Generic close buttons (for KPI-spawned panels)
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-close');
      const panel = document.getElementById(id);
      if (panel) panel.hidden = true;
    });
  });

  els.allGrnFilter.addEventListener('input', () => renderAllGrns());
}

/* ---------- KPI drill-downs ---------- */
function handleKpiClick(kind) {
  if (!state.summary) return;
  switch (kind) {
    case 'site':  showSiteOverview(); break;
    case 'po':    focusPoPanel();     break;
    case 'grn':   showAllGrns();      break;
    case 'nonpo': focusNonPoPanel();  break;
  }
}

function showSiteOverview() {
  const s = state.summary;
  const pos = s.pos || [];
  const nonPo = s.nonPoGrns || [];

  const vendors = new Set(pos.map(p => p.Vendor_ID).filter(Boolean));
  nonPo.forEach(g => g.Vendor_ID && vendors.add(g.Vendor_ID));

  const totalPoValue = pos.reduce((sum, p) => sum + Number(p.Total_Incl_GST || 0), 0);
  const grnsCount = pos.reduce((sum, p) => sum + (p.grns ? p.grns.length : 0), 0) + nonPo.length;
  const nonPoValue = nonPo.reduce((sum, g) => sum + Number(g.Invoice_Value || 0), 0);

  const statusCounts = {};
  pos.forEach(p => {
    const k = p.Status_Label || p.Status_Code || 'Unknown';
    statusCounts[k] = (statusCounts[k] || 0) + 1;
  });
  const statusHtml = Object.keys(statusCounts).length
    ? Object.entries(statusCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${renderStatus(k)} <strong>${v}</strong>`).join('<br>')
    : '<span class="muted">-</span>';

  // Top 5 vendors by PO total
  const vendorTotals = {};
  pos.forEach(p => {
    const k = p.Vendor_ID || 'Unknown';
    vendorTotals[k] = (vendorTotals[k] || 0) + Number(p.Total_Incl_GST || 0);
  });
  const topVendors = Object.entries(vendorTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${escapeHtml(k)} - <strong>${formatMoney(v)}</strong>`)
    .join('<br>') || '<span class="muted">-</span>';

  els.siteOverviewName.textContent = s.site ? `(${s.site})` : '';
  els.siteOverviewGrid.innerHTML = [
    cell('Site', escapeHtml(s.site || '-')),
    cell('Purchase Orders', formatNum(pos.length)),
    cell('Total GRNs', formatNum(grnsCount)),
    cell('Non-PO GRNs', formatNum(nonPo.length)),
    cell('Unique Vendors', formatNum(vendors.size)),
    cell('Total PO Value', formatMoney(totalPoValue)),
    cell('Non-PO GRN Value', formatMoney(nonPoValue)),
    cell('PO Status Mix', statusHtml),
    cell('Top Vendors (by PO value)', topVendors)
  ].join('');
  showAndFlash(els.siteOverviewPanel);
}

function focusPoPanel() {
  if (els.resultsPanel.hidden) return;
  els.poFilter.value = '';
  state.poTextFilter = '';
  applySortAndRender();
  showAndFlash(els.resultsPanel);
  setTimeout(() => els.poFilter.focus(), 250);
}

function focusNonPoPanel() {
  if ((state.summary?.nonPoGrns || []).length === 0) {
    showStatus('No non-PO GRNs for this site / date range.', 'busy');
    return;
  }
  showAndFlash(els.nonPoPanel);
}

function showAllGrns() {
  renderAllGrns();
  showAndFlash(els.allGrnPanel);
}

function renderAllGrns() {
  if (!state.summary) return;
  const rows = [];
  (state.summary.pos || []).forEach(p => {
    (p.grns || []).forEach(g => {
      rows.push({
        GRN_ID: g.GRN_ID,
        PO_ID: p.PO_ID,
        Vendor_ID: p.Vendor_ID,
        Invoice_Number: g.Invoice_Number,
        Invoice_Value: g.Invoice_Value,
        Invoice_Date: g.Invoice_Date,
        Status: g.Status,
        PO_Type: g.PO_Type || 'PO'
      });
    });
  });
  (state.summary.nonPoGrns || []).forEach(g => {
    rows.push({
      GRN_ID: g.GRN_ID,
      PO_ID: '',
      Vendor_ID: g.Vendor_ID,
      Invoice_Number: g.Invoice_Number,
      Invoice_Value: g.Invoice_Value,
      Invoice_Date: g.Invoice_Date,
      Status: g.Status,
      PO_Type: g.PO_Type || 'Non-PO'
    });
  });

  const q = (els.allGrnFilter.value || '').trim().toLowerCase();
  const filtered = q
    ? rows.filter(r => [r.GRN_ID, r.PO_ID, r.Vendor_ID, r.Invoice_Number, r.Status, r.PO_Type]
        .some(v => String(v ?? '').toLowerCase().includes(q)))
    : rows;

  els.allGrnBadge.textContent = `(${filtered.length}${q ? ' of ' + rows.length : ''})`;

  if (!filtered.length) {
    els.allGrnTbody.innerHTML = `<tr><td colspan="8" class="empty-state">No GRNs match.</td></tr>`;
    return;
  }

  els.allGrnTbody.innerHTML = filtered.map(r => `
    <tr>
      <td>${r.GRN_ID
            ? `<a class="grn-link" data-grn="${escapeAttr(r.GRN_ID)}">${escapeHtml(r.GRN_ID)}</a>`
            : '-'}</td>
      <td>${r.PO_ID
            ? `<a class="po-id-link" data-po="${escapeHtml(r.PO_ID)}">${escapeHtml(r.PO_ID)}</a>`
            : '<span class="muted">Non-PO</span>'}</td>
      <td>${escapeHtml(r.Vendor_ID || '-')}</td>
      <td>${escapeHtml(r.Invoice_Number || '-')}</td>
      <td class="num">${formatMoney(r.Invoice_Value)}</td>
      <td>${formatDate(r.Invoice_Date)}</td>
      <td>${renderStatus(r.Status)}</td>
      <td>${escapeHtml(r.PO_Type || '-')}</td>
    </tr>
  `).join('');

  els.allGrnTbody.querySelectorAll('.po-id-link').forEach(a => {
    a.addEventListener('click', () => loadPoDetail(a.getAttribute('data-po')));
  });
}

function showAndFlash(panel) {
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  panel.classList.remove('flash');
  // restart animation
  void panel.offsetWidth;
  panel.classList.add('flash');
}

/* ---------- API ---------- */
async function api(action, params = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== '' && v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  setConn('Loading...', 'conn-busy');
  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) {
    setConn('Error', 'conn-error');
    throw new Error(`HTTP ${res.status} from Apps Script`);
  }
  const json = await res.json();
  if (!json.ok) {
    setConn('Error', 'conn-error');
    throw new Error(json.error || 'Unknown server error');
  }
  setConn('Connected', 'conn-ok');
  els.lastSync.textContent = 'Last sync: ' + new Date().toLocaleString();
  return json.data;
}

/* ---------- Site loading ---------- */
async function loadSites() {
  try {
    showStatus('Loading sites...', 'busy');
    const sites = await api('sites');
    state.sites = sites || [];
    els.siteList.innerHTML = state.sites.map(s =>
      `<option value="${escapeHtml(s)}"></option>`
    ).join('');
    hideStatus();
  } catch (err) {
    showStatus('Could not load sites: ' + err.message, 'error');
  }
}

/* ---------- Search / summary ---------- */
async function runSearch() {
  const site = els.siteInput.value.trim();
  if (!site) {
    showStatus('Enter a site to search.', 'error');
    return;
  }
  try {
    setBtnLoading(els.searchBtn, true);
    showStatus('Loading site data...', 'busy');
    const data = await api('siteSummary', {
      site,
      from: els.fromDate.value,
      to: els.toDate.value
    });
    state.summary = data;
    syncSortFromDropdown();
    applySortAndRender();
    renderKpis(data);
    renderNonPoGrns(data.nonPoGrns || []);
    els.detailPanel.hidden = true;
    hideStatus();
    if (!data.pos.length && !(data.nonPoGrns || []).length) {
      showStatus('No POs or GRNs found for this site / date range.', 'busy');
    }
  } catch (err) {
    showStatus('Search failed: ' + err.message, 'error');
  } finally {
    setBtnLoading(els.searchBtn, false);
  }
}

function clearAll() {
  els.siteInput.value = '';
  els.fromDate.value = '';
  els.toDate.value = '';
  els.poFilter.value = '';
  state.summary = null;
  state.filteredPos = [];
  state.poTextFilter = '';
  els.kpiRow.hidden = true;
  els.resultsPanel.hidden = true;
  els.nonPoPanel.hidden = true;
  els.detailPanel.hidden = true;
  els.grnDetailPanel.hidden = true;
  els.siteOverviewPanel.hidden = true;
  els.allGrnPanel.hidden = true;
  hideStatus();
}

/* ---------- Render: KPIs ---------- */
function renderKpis(data) {
  els.kpiRow.hidden = false;
  els.kpiSite.textContent = data.site || '-';
  els.kpiPo.textContent = data.counts?.pos ?? 0;
  els.kpiGrn.textContent = data.counts?.grns ?? 0;
  els.kpiNonPo.textContent = data.counts?.nonPoGrns ?? 0;
}

/* ---------- Render: PO list ---------- */
function syncSortFromDropdown() {
  const v = els.sortBy.value;
  const idx = v.lastIndexOf('_');
  state.sort.key = v.slice(0, idx);
  state.sort.dir = v.slice(idx + 1);
}

function applySortAndRender() {
  if (!state.summary) return;
  const pos = (state.summary.pos || []).slice();

  // text filter
  const q = state.poTextFilter;
  const filtered = q
    ? pos.filter(p => [
      p.PO_ID, p.Vendor_ID, p.PO_No_Tally, p.Status_Label, p.PR_ID
    ].some(v => String(v ?? '').toLowerCase().includes(q)))
    : pos;

  // sort
  const { key, dir } = state.sort;
  filtered.sort((a, b) => {
    const va = a[key], vb = b[key];
    let cmp;
    if (key === 'PO_Date' || key === 'Last_Action_At') {
      cmp = (new Date(va || 0)) - (new Date(vb || 0));
    } else if (key === 'Total_Incl_GST') {
      cmp = Number(va || 0) - Number(vb || 0);
    } else {
      cmp = String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true });
    }
    return dir === 'asc' ? cmp : -cmp;
  });

  state.filteredPos = filtered;
  renderPoTable(filtered);
  syncSortIndicators();
}

function syncSortIndicators() {
  els.poTable.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.getAttribute('data-sort') === state.sort.key) {
      th.classList.add(state.sort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

function renderPoTable(pos) {
  els.resultsPanel.hidden = false;
  els.poCountBadge.textContent = pos.length ? `(${pos.length})` : '';
  if (!pos.length) {
    els.poTbody.innerHTML = '';
    els.poEmpty.hidden = false;
    return;
  }
  els.poEmpty.hidden = true;
  els.poTbody.innerHTML = pos.map(p => {
    const grnChips = (p.grns || []).length
      ? p.grns.map(g => `<span class="grn-chip" data-grn="${escapeHtml(g.GRN_ID)}">${escapeHtml(g.GRN_ID)}</span>`).join('')
      : '<span class="muted">-</span>';
    const tick = p.Fully_Received
      ? `<span class="tick-ok" title="Fully received (Ordered ${formatNum(p.Ordered_Qty)} = Received ${formatNum(p.Received_Qty)})">&#x2713;</span>`
      : '';
    return `
      <tr${p.Fully_Received ? ' class="row-fully-received"' : ''}>
        <td><a class="po-id-link" data-po="${escapeHtml(p.PO_ID)}">${escapeHtml(p.PO_ID)}</a> ${tick}</td>
        <td>${formatDate(p.PO_Date)}</td>
        <td>${escapeHtml(p.Vendor_ID || '-')}</td>
        <td>${escapeHtml(p.PO_No_Tally || '-')}</td>
        <td class="num">${formatMoney(p.Total_Incl_GST)}</td>
        <td>${renderStatus(p.Status_Label || p.Status_Code)}</td>
        <td>${grnChips}</td>
      </tr>`;
  }).join('');

  els.poTbody.querySelectorAll('.po-id-link').forEach(a => {
    a.addEventListener('click', () => loadPoDetail(a.getAttribute('data-po')));
  });
}

/* ---------- Render: Non-PO GRNs ---------- */
function renderNonPoGrns(list) {
  if (!list.length) {
    els.nonPoPanel.hidden = true;
    return;
  }
  els.nonPoPanel.hidden = false;
  els.nonPoBadge.textContent = `(${list.length})`;
  els.nonPoTbody.innerHTML = list.map(g => `
    <tr>
      <td><span class="grn-link" data-grn="${escapeAttr(g.GRN_ID)}">${escapeHtml(g.GRN_ID)}</span></td>
      <td>${escapeHtml(g.Vendor_ID || '-')}</td>
      <td>${escapeHtml(g.Invoice_Number || '-')}</td>
      <td class="num">${formatMoney(g.Invoice_Value)}</td>
      <td>${formatDate(g.Invoice_Date)}</td>
      <td>${renderStatus(g.Status)}</td>
      <td>${escapeHtml(g.Created_By_Name || '-')}</td>
    </tr>
  `).join('');
}

/* ---------- PO detail ---------- */
async function loadPoDetail(poId) {
  try {
    showStatus('Loading PO ' + poId + '...', 'busy');
    const data = await api('poDetail', { poId });
    renderPoDetail(data);
    hideStatus();
    els.detailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showStatus('Could not load PO detail: ' + err.message, 'error');
  }
}

/* ---------- GRN detail ---------- */
async function loadGrnDetail(grnId) {
  try {
    showStatus('Loading GRN ' + grnId + '...', 'busy');
    const data = await api('grnDetail', { grnId });
    renderGrnDetail(data);
    hideStatus();
    showAndFlash(els.grnDetailPanel);
  } catch (err) {
    showStatus('Could not load GRN detail: ' + err.message, 'error');
  }
}

function renderGrnDetail(data) {
  const g = data.grn || {};
  const items = data.items || [];

  els.grnDetailId.textContent = g.GRN_ID ? `(${g.GRN_ID})` : '';

  els.grnDetailGrid.innerHTML = [
    cell('GRN ID', escapeHtml(g.GRN_ID || '-')),
    cell('PO ID', g.PO_ID
      ? `<a class="po-id-link" data-po="${escapeAttr(g.PO_ID)}">${escapeHtml(g.PO_ID)}</a>`
      : '<span class="muted">Non-PO</span>'),
    cell('PO Type', escapeHtml(g.PO_Type || '-')),
    cell('Site', escapeHtml(g.Site || '-')),
    cell('Vendor', escapeHtml(g.Vendor_ID || '-')),
    cell('Invoice #', escapeHtml(g.Invoice_Number || '-')),
    cell('Invoice Value', formatMoney(g.Invoice_Value)),
    cell('Invoice Date', formatDate(g.Invoice_Date)),
    cell('LR / Challan #', escapeHtml(g.LR_Number || '-')),
    cell('Vehicle #', escapeHtml(g.Vehicle_number || '-')),
    cell('Status', renderStatus(g.Status)),
    cell('Created By', escapeHtml(g.Created_By_Name || '-')),
    cell('Created At', formatDate(g.Created_At)),
    cell('LR / Challan File',
      g.LR_URL ? `<a href="${escapeAttr(g.LR_URL)}" target="_blank" rel="noopener">Open</a>` : '<span class="muted">-</span>'),
    cell('Photos',
      g.Photos_URL ? `<a href="${escapeAttr(g.Photos_URL)}" target="_blank" rel="noopener">Open</a>` : '<span class="muted">-</span>'),
    cell('Approved GRN PDF',
      g.Approved_GRN_PDF_URL ? `<a href="${escapeAttr(g.Approved_GRN_PDF_URL)}" target="_blank" rel="noopener">Open</a>` : '<span class="muted">-</span>'),
    cell('Remarks', escapeHtml(g.Remarks || '-'))
  ].join('');

  // Re-bind PO-link inside GRN detail (delegated handler covers data-grn but data-po needs explicit binding here)
  els.grnDetailGrid.querySelectorAll('.po-id-link').forEach(a => {
    a.addEventListener('click', () => loadPoDetail(a.getAttribute('data-po')));
  });

  if (!items.length) {
    els.grnDetailItemsTbody.innerHTML = `
      <tr><td colspan="9" class="empty-state">No items recorded on this GRN.</td></tr>`;
    return;
  }

  els.grnDetailItemsTbody.innerHTML = items.map(it => {
    const diff = Number(it.Difference || 0);
    const diffCls = diff > 0 ? 'status-pending' : diff < 0 ? 'status-rejected' : 'status-approved';
    return `
      <tr>
        <td>${escapeHtml(it.Line_No || '-')}</td>
        <td>${escapeHtml(it.Item_Name || '-')}</td>
        <td class="num">${formatNum(it.Ordered_Qty)}</td>
        <td class="num">${formatNum(it.Received_Qty)}</td>
        <td>${escapeHtml(it.UOM || '-')}</td>
        <td class="num"><span class="status-pill ${diffCls}">${formatNum(diff)}</span></td>
        <td class="num">${formatNum(it.Defective_Qty)}</td>
        <td class="num">${formatMoney(it.Item_Total_Inc_GST)}</td>
        <td>${renderStatus(it.Line_Status)}</td>
      </tr>`;
  }).join('');
}

function renderPoDetail(data) {
  const po = data.po || {};
  els.detailPanel.hidden = false;
  els.detailPoId.textContent = po.PO_ID ? `(${po.PO_ID})` : '';

  const grnIds = (data.grns || []).map(g => g.GRN_ID).filter(Boolean);
  const grnChips = grnIds.length
    ? grnIds.map(id => `<span class="grn-chip" data-grn="${escapeAttr(id)}">${escapeHtml(id)}</span>`).join('')
    : '<span class="muted">No GRNs yet</span>';

  els.detailGrid.innerHTML = [
    cell('PO ID', escapeHtml(po.PO_ID)),
    cell('PR ID', escapeHtml(po.PR_ID || '-')),
    cell('Site', escapeHtml(po.Site || '-')),
    cell('Vendor', escapeHtml(po.Vendor_ID || '-')),
    cell('Tally PO No.', escapeHtml(po.PO_No_Tally || '-')),
    cell('PO Date', formatDate(po.PO_Date)),
    cell('Total (incl. GST)', formatMoney(po.Total_Incl_GST)),
    cell('Status', renderStatus(po.Status_Label || po.Status_Code)),
    cell('GRN(s)', grnChips),
    cell('PO File',
      po.PO_File_URL
        ? `<a href="${escapeAttr(po.PO_File_URL)}" target="_blank" rel="noopener">Open</a>`
        : '<span class="muted">-</span>'
    ),
    cell('Remarks', escapeHtml(po.PO_Remarks || '-'))
  ].join('');

  const items = data.mergedItems || [];
  if (!items.length) {
    els.detailItemsTbody.innerHTML = `
      <tr><td colspan="9" class="empty-state">No items on this PO.</td></tr>`;
    return;
  }

  els.detailItemsTbody.innerHTML = items.map(it => {
    const diff = (Number(it.Ordered_Qty || 0) - Number(it.Received_Qty || 0));
    const diffCls = diff > 0 ? 'status-pending' : diff < 0 ? 'status-rejected' : 'status-approved';
    const grnList = (it.GRN_IDs || []).length
      ? it.GRN_IDs.map(id => `<span class="grn-chip" data-grn="${escapeAttr(id)}">${escapeHtml(id)}</span>`).join('')
      : '<span class="muted">-</span>';
    return `
      <tr>
        <td>${escapeHtml(it.Line_No || '-')}</td>
        <td>${escapeHtml(it.Item_Name || '-')}</td>
        <td>${escapeHtml(it.Vendor_ID || '-')}</td>
        <td>${grnList}</td>
        <td class="num">${formatNum(it.Ordered_Qty)}</td>
        <td class="num">${formatNum(it.Received_Qty)}</td>
        <td>${escapeHtml(it.UOM || '-')}</td>
        <td class="num"><span class="status-pill ${diffCls}">${formatNum(diff)}</span></td>
        <td class="num">${formatMoney(it.Item_Total_Inc_GST_Received || it.Line_Total)}</td>
      </tr>`;
  }).join('');
}

/* ---------- UI helpers ---------- */
function cell(label, valueHtml) {
  return `<div class="detail-cell"><div class="lbl">${label}</div><div class="val">${valueHtml ?? '-'}</div></div>`;
}

function renderStatus(label) {
  if (!label) return '<span class="status-pill">-</span>';
  const norm = String(label).toLowerCase();
  let cls = '';
  if (/(approved|completed|done|received|posted)/.test(norm)) cls = 'status-approved';
  else if (/(pending|draft|in.?progress|partial)/.test(norm)) cls = 'status-pending';
  else if (/(rejected|cancel|fail)/.test(norm)) cls = 'status-rejected';
  return `<span class="status-pill ${cls}">${escapeHtml(label)}</span>`;
}

function setConn(text, cls) {
  els.conn.textContent = text;
  els.conn.className = 'conn-pill ' + (cls || 'conn-idle');
}

function showStatus(msg, kind) {
  els.statusBar.hidden = false;
  els.statusBar.textContent = msg;
  els.statusBar.className = 'status-bar ' + (kind || '');
}
function hideStatus() { els.statusBar.hidden = true; els.statusBar.textContent = ''; }

function setBtnLoading(btn, on) {
  btn.classList.toggle('is-loading', !!on);
  btn.disabled = !!on;
}

function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(v) { return escapeHtml(v); }

function formatDate(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return escapeHtml(v);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

function formatNum(v) {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (isNaN(n)) return escapeHtml(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMoney(v) {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (isNaN(n)) return escapeHtml(v);
  return n.toLocaleString(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
}
