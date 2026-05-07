/**
 * GRN Dashboard - Google Apps Script Backend
 *
 * Deploy as Web App:
 *   1. Open the bound Google Sheet (or attach this script to the sheet).
 *   2. Extensions -> Apps Script, paste this file as Code.gs.
 *   3. Deploy -> New deployment -> type "Web app".
 *      Execute as: Me   |   Who has access: Anyone (or Anyone with the link).
 *   4. Copy the resulting /exec URL into APPS_SCRIPT_URL inside app.js.
 *
 * Endpoints (all via GET ?action=...):
 *   action=ping              -> health check
 *   action=sites             -> distinct list of sites (for autocomplete)
 *   action=siteSummary&site=<value>&from=<yyyy-mm-dd>&to=<yyyy-mm-dd>
 *                            -> POs for the site + GRNs grouped under each PO
 *                               + a "nonPoGrns" list (GRNs with no PO_ID)
 *   action=poDetail&poId=<value>
 *                            -> PO header + items + linked GRNs + GRN items
 *                               (everything needed for the detail card)
 */

const SHEET_PO_MASTER  = 'PO_MASTER';
const SHEET_PO_ITEMS   = 'PO_ITEMS';
const SHEET_GRN_MASTER = 'GRN_MASTER';
const SHEET_GRN_ITEMS  = 'GRN_ITEMS';

// If the script is bound to the sheet you don't need to set this.
// Otherwise paste the spreadsheet ID here.
const SPREADSHEET_ID = '197EDvot9WEwLKpr6fd7RIrG3Z7tgdfYnforWLdIx1bw';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'ping';
  try {
    let payload;
    switch (action) {
      case 'ping':
        payload = { ok: true, ts: new Date().toISOString() };
        break;
      case 'sites':
        payload = getSites();
        break;
      case 'siteSummary':
        payload = getSiteSummary(
          e.parameter.site || '',
          e.parameter.from || '',
          e.parameter.to   || ''
        );
        break;
      case 'poDetail':
        payload = getPoDetail(e.parameter.poId || '');
        break;
      case 'grnDetail':
        payload = getGrnDetail(e.parameter.grnId || '');
        break;
      default:
        payload = { error: 'Unknown action: ' + action };
    }
    return jsonOut({ ok: true, action: action, data: payload });
  } catch (err) {
    return jsonOut({ ok: false, action: action, error: err.message, stack: err.stack });
  }
}

/* ---------- Core data access ---------- */

function getSpreadsheet_() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function readSheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { headers: values[0] || [], rows: [] };
  const headers = values[0].map(h => String(h).trim());
  const rows = values.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i]; });
    return obj;
  }).filter(o => Object.values(o).some(v => v !== '' && v !== null));
  return { headers, rows };
}

function getSites() {
  const { rows: poRows }  = readSheet_(SHEET_PO_MASTER);
  const { rows: grnRows } = readSheet_(SHEET_GRN_MASTER);
  const set = new Set();
  poRows.forEach(r => { if (r.Site) set.add(String(r.Site).trim()); });
  grnRows.forEach(r => { if (r.Site) set.add(String(r.Site).trim()); });
  return Array.from(set).filter(Boolean).sort();
}

function getSiteSummary(site, fromStr, toStr) {
  if (!site) throw new Error('site is required');
  const siteKey = String(site).trim().toLowerCase();
  const from = parseDate_(fromStr);
  const to   = parseDate_(toStr, true);

  const { rows: poRows }   = readSheet_(SHEET_PO_MASTER);
  const { rows: grnRows }  = readSheet_(SHEET_GRN_MASTER);
  const { rows: poItems }  = readSheet_(SHEET_PO_ITEMS);
  const { rows: grnItems } = readSheet_(SHEET_GRN_ITEMS);

  const sitePos = poRows.filter(r => String(r.Site || '').trim().toLowerCase() === siteKey);
  const siteGrns = grnRows.filter(r => String(r.Site || '').trim().toLowerCase() === siteKey);

  // Pre-compute ordered totals per PO (from PO_ITEMS).
  const orderedByPo = {};
  poItems.forEach(it => {
    const k = String(it.PO_ID || '').trim();
    if (!k) return;
    orderedByPo[k] = (orderedByPo[k] || 0) + Number(it.Qty || 0);
  });

  // Pre-compute received totals per PO (from GRN_ITEMS).
  const receivedByPo = {};
  grnItems.forEach(gi => {
    const k = String(gi.PO_ID || '').trim();
    if (!k) return;
    receivedByPo[k] = (receivedByPo[k] || 0) + Number(gi.Received_Qty || 0);
  });

  const inRange = (d) => {
    if (!from && !to) return true;
    const dt = parseDate_(d);
    if (!dt) return false;
    if (from && dt < from) return false;
    if (to && dt > to) return false;
    return true;
  };

  const filteredPos  = sitePos.filter(p => inRange(p.PO_Date));
  const filteredGrns = siteGrns.filter(g => inRange(g.Invoice_Date || g.Created_At || g.Timestamp));

  const grnsByPo = {};
  filteredGrns.forEach(g => {
    const key = String(g.PO_ID || '').trim();
    if (!key) return;
    (grnsByPo[key] = grnsByPo[key] || []).push({
      GRN_ID: g.GRN_ID,
      Invoice_Number: g['Invoice Number'],
      Invoice_Value: g['Invoice Value'],
      Invoice_Date: toIso_(g.Invoice_Date),
      Status: g.Status,
      PO_Type: g.PO_Type,
      Created_At: toIso_(g.Created_At),
      Created_By_Name: g.Created_By_Name
    });
  });

  const nonPoGrns = filteredGrns
    .filter(g => !String(g.PO_ID || '').trim())
    .map(g => ({
      GRN_ID: g.GRN_ID,
      Vendor_ID: g.Vendor_ID,
      Invoice_Number: g['Invoice Number'],
      Invoice_Value: g['Invoice Value'],
      Invoice_Date: toIso_(g.Invoice_Date),
      Status: g.Status,
      PO_Type: g.PO_Type,
      Created_At: toIso_(g.Created_At),
      Created_By_Name: g.Created_By_Name
    }));

  const pos = filteredPos.map(p => {
    const poKey = String(p.PO_ID || '').trim();
    const ordered  = Number(orderedByPo[poKey]  || 0);
    const received = Number(receivedByPo[poKey] || 0);
    const diff = ordered - received;
    // Fully received only when there are items AND received matches ordered.
    const fullyReceived = ordered > 0 && Math.abs(diff) < 0.0001;
    return {
      PO_ID: p.PO_ID,
      PR_ID: p.PR_ID,
      Site: p.Site,
      Vendor_ID: p.Vendor_ID,
      PO_No_Tally: p.PO_No_Tally,
      PO_Date: toIso_(p.PO_Date),
      PO_File_URL: p.PO_File_URL,
      Total_Incl_GST: p.Total_Incl_GST,
      Status_Code: p.Status_Code,
      Status_Label: p.Status_Label,
      PO_Remarks: p.PO_Remarks,
      Ordered_Qty: ordered,
      Received_Qty: received,
      Qty_Difference: diff,
      Fully_Received: fullyReceived,
      grns: grnsByPo[poKey] || []
    };
  });

  return {
    site: site,
    counts: {
      pos: pos.length,
      grns: filteredGrns.length,
      nonPoGrns: nonPoGrns.length
    },
    pos: pos,
    nonPoGrns: nonPoGrns
  };
}

function getPoDetail(poId) {
  if (!poId) throw new Error('poId is required');
  const key = String(poId).trim();

  const { rows: poRows }   = readSheet_(SHEET_PO_MASTER);
  const { rows: poItems }  = readSheet_(SHEET_PO_ITEMS);
  const { rows: grnRows }  = readSheet_(SHEET_GRN_MASTER);
  const { rows: grnItems } = readSheet_(SHEET_GRN_ITEMS);

  const po = poRows.find(r => String(r.PO_ID || '').trim() === key);
  if (!po) throw new Error('PO not found: ' + poId);

  const items = poItems.filter(r => String(r.PO_ID || '').trim() === key)
    .sort((a, b) => Number(a.Line_No || 0) - Number(b.Line_No || 0));

  const grns = grnRows.filter(r => String(r.PO_ID || '').trim() === key);
  const grnIds = new Set(grns.map(g => String(g.GRN_ID || '').trim()));

  const linkedGrnItems = grnItems.filter(gi =>
    grnIds.has(String(gi.GRN_ID || '').trim()) &&
    String(gi.PO_ID || '').trim() === key
  );

  // Aggregate received qty per item line across all GRNs.
  const receivedByLine = {};
  linkedGrnItems.forEach(gi => {
    const ln = String(gi.Line_No || '').trim();
    const k = ln || (gi.Item_Name ? 'name:' + gi.Item_Name : 'idx:' + Math.random());
    if (!receivedByLine[k]) {
      receivedByLine[k] = {
        Line_No: gi.Line_No,
        Item_Name: gi.Item_Name,
        Item_Code: gi.Item_Code,
        UOM: gi.UOM,
        Received_Qty: 0,
        Defective_Qty: 0,
        Invoice_Qty: 0,
        Item_Total_Inc_GST: 0,
        GRN_IDs: new Set()
      };
    }
    receivedByLine[k].Received_Qty   += Number(gi.Received_Qty || 0);
    receivedByLine[k].Defective_Qty  += Number(gi.Defective_Qty || 0);
    receivedByLine[k].Invoice_Qty    += Number(gi.Invoice_Qty || 0);
    receivedByLine[k].Item_Total_Inc_GST += Number(gi['Item_Total_Inc._GST'] || 0);
    if (gi.GRN_ID) receivedByLine[k].GRN_IDs.add(gi.GRN_ID);
  });

  // Build the merged item-level view for the drill-down card.
  const mergedItems = items.map(it => {
    const ln = String(it.Line_No || '').trim();
    const recv = receivedByLine[ln] || null;
    const orderedQty = Number(it.Qty || 0);
    const receivedQty = recv ? recv.Received_Qty : 0;
    return {
      Line_No: it.Line_No,
      Item_Name: it.Item_Name,
      Vendor_ID: po.Vendor_ID,
      Ordered_Qty: orderedQty,
      Received_Qty: receivedQty,
      UOM: it.UOM,
      Difference: orderedQty - receivedQty,
      Rate: Number(it.Rate || 0),
      GST_Pct: Number(it['GST_%'] || 0),
      Line_Total: Number(it.Line_Total || 0),
      GRN_IDs: recv ? Array.from(recv.GRN_IDs) : [],
      Item_Total_Inc_GST_Received: recv ? recv.Item_Total_Inc_GST : 0
    };
  });

  return {
    po: {
      PO_ID: po.PO_ID,
      PR_ID: po.PR_ID,
      Site: po.Site,
      Vendor_ID: po.Vendor_ID,
      PO_No_Tally: po.PO_No_Tally,
      PO_Date: toIso_(po.PO_Date),
      PO_File_URL: po.PO_File_URL,
      Total_Incl_GST: po.Total_Incl_GST,
      Status_Code: po.Status_Code,
      Status_Label: po.Status_Label,
      PO_Remarks: po.PO_Remarks,
      Freight_Charges: po.Freight_Charges,
      Freight_Amount: po.Freight_Amount,
      Installation_Charges: po.Installation_Charges,
      Installation_Amount: po.Installation_Amount,
      Last_Action_By: po.Last_Action_By,
      Last_Action_At: toIso_(po.Last_Action_At)
    },
    items: items,
    grns: grns.map(g => ({
      GRN_ID: g.GRN_ID,
      Invoice_Number: g['Invoice Number'],
      Invoice_Value: g['Invoice Value'],
      Invoice_Date: toIso_(g.Invoice_Date),
      Status: g.Status,
      PO_Type: g.PO_Type,
      Vehicle_number: g['Vehicle number'],
      Created_By_Name: g.Created_By_Name,
      Created_At: toIso_(g.Created_At)
    })),
    mergedItems: mergedItems
  };
}

function getGrnDetail(grnId) {
  if (!grnId) throw new Error('grnId is required');
  const key = String(grnId).trim();
  const { rows: grnRows }  = readSheet_(SHEET_GRN_MASTER);
  const { rows: grnItems } = readSheet_(SHEET_GRN_ITEMS);
  const grn = grnRows.find(r => String(r.GRN_ID || '').trim() === key);
  if (!grn) throw new Error('GRN not found: ' + grnId);

  const rawItems = grnItems
    .filter(r => String(r.GRN_ID || '').trim() === key)
    .sort((a, b) => Number(a.Line_No || 0) - Number(b.Line_No || 0));

  const items = rawItems.map(r => {
    const ordered  = Number(r.Ordered_Qty || 0);
    const received = Number(r.Received_Qty || 0);
    return {
      Line_No: r.Line_No,
      Item_Code: r.Item_Code,
      Item_Name: r.Item_Name,
      UOM: r.UOM,
      Ordered_Qty: ordered,
      Received_Qty: received,
      Invoice_Qty: Number(r.Invoice_Qty || 0),
      Defective_Qty: Number(r.Defective_Qty || 0),
      Balance_Qty: r.Balance_Qty !== '' && r.Balance_Qty !== undefined && r.Balance_Qty !== null
        ? Number(r.Balance_Qty)
        : (ordered - received),
      Difference: ordered - received,
      Item_Total_Inc_GST: Number(r['Item_Total_Inc._GST'] || 0),
      Condition: r.Condition,
      Line_Status: r.Line_Status,
      Receiver_Remarks: r.Receiver_Remarks
    };
  });

  return {
    grn: {
      GRN_ID: grn.GRN_ID,
      PO_ID: grn.PO_ID,
      Site: grn.Site,
      Vendor_ID: grn.Vendor_ID,
      Invoice_Number: grn['Invoice Number'],
      Invoice_Value: grn['Invoice Value'],
      Invoice_Date: toIso_(grn.Invoice_Date),
      LR_Number: grn['LR/Delivery Challan_Number'],
      LR_URL: grn['LR/ Delivery Challan_URL'],
      Photos_URL: grn.Photos_URL,
      Other_Docs_URL: grn.Other_Docs_URL,
      Vehicle_number: grn['Vehicle number'],
      Created_At: toIso_(grn.Created_At),
      Created_By_Name: grn.Created_By_Name,
      Status: grn.Status,
      Remarks: grn.Remarks,
      PO_Type: grn.PO_Type,
      Approved_GRN_PDF_URL: grn.Approved_GRN_PDF_URL
    },
    items: items
  };
}

/* ---------- Helpers ---------- */

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseDate_(v, endOfDay) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

function toIso_(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}
