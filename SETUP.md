# GRN Dashboard - Setup

## 1. Backend (Google Apps Script)

1. Open the Google Sheet:
   <https://docs.google.com/spreadsheets/d/197EDvot9WEwLKpr6fd7RIrG3Z7tgdfYnforWLdIx1bw/edit>
2. **Extensions -> Apps Script**.
3. Replace the default `Code.gs` with the contents of `Code.gs` from this folder.
4. The constant `SPREADSHEET_ID` is already filled in. If you bind the script to the
   sheet, you can ignore it - the script falls back to `getActiveSpreadsheet()` when
   the constant is empty.
5. **Deploy -> New deployment -> Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone with the link (required so the dashboard can call it
     without OAuth from the browser).
6. Authorize the script when prompted, then copy the **Web app URL** that ends in
   `/exec`.

## 2. Frontend

1. Open `app.js` and replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with the
   `/exec` URL from step 1.6.
2. Open `index.html` directly in a browser, or host the folder on any static host
   (GitHub Pages, Netlify, an internal IIS share, etc.).

## 3. How the dashboard maps to your sheets

| Action | Endpoint | Used by |
| --- | --- | --- |
| List sites | `?action=sites` | Site search autocomplete |
| Site summary | `?action=siteSummary&site=...&from=...&to=...` | Main results table + Non-PO GRN table + KPIs |
| PO drill-down | `?action=poDetail&poId=...` | Detail card with merged items + GRNs |
| GRN drill-down | `?action=grnDetail&grnId=...` | Reserved (extend later if needed) |

The PO detail merges `PO_ITEMS` against `GRN_ITEMS` on `(PO_ID, Line_No)` so the
card shows the ordered qty vs the cumulative received qty, the difference, and the
list of GRN IDs that contributed receipts for that line.

## 4. Common gotchas

- If you see **"Failed to fetch"** from the browser, redeploy the Web App with
  *Anyone with the link* and re-copy the URL (Apps Script issues a new URL on every
  manual deployment - "Manage deployments" -> the existing deployment keeps the
  original URL, useful when you want to update code without changing URLs).
- If a column header in the sheet is renamed, update the matching key in `Code.gs`.
  Headers with special characters in your sheet (e.g. `Invoice Number`,
  `LR/Delivery Challan_Number`, `Item_Total_Inc._GST`, `GST_%`) are read with
  bracket notation in the script - keep them spelled identically to the sheet.
- Date filters use `PO_Date` for POs and `Invoice_Date` (falling back to
  `Created_At`/`Timestamp`) for GRNs.
