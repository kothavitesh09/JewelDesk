function money0(n) {
  const x = Number(n);
  if (!isFinite(x)) return "0";
  return x.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function byId(id) {
  return document.getElementById(id);
}

function toISODateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

function getMonthKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function groupBillsByMonth(bills) {
  const groups = new Map();

  bills.forEach((bill) => {
    const key = getMonthKey(bill.date);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: getMonthLabel(bill.date),
        total: 0,
        bills: [],
      });
    }

    const group = groups.get(key);
    group.bills.push(bill);
    group.total += Number(bill.final_amount || 0);
  });

  return Array.from(groups.values())
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((group) => ({
      ...group,
      bills: group.bills.sort((a, b) => {
        const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
        if (dateCompare !== 0) return dateCompare;
        return Number(b.invoice_no || 0) - Number(a.invoice_no || 0);
      }),
    }));
}

async function fetchBills(from, to) {
  const params = new URLSearchParams();
  if (from) params.append("from", from);
  if (to) params.append("to", to);
  const url = `/bills?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data && data.error ? data.error : "Failed to load bills.");
  }
  return data.bills || [];
}

async function deleteBill(invoiceNo) {
  const res = await fetch(`/bills/${encodeURIComponent(invoiceNo)}`, {
    method: "DELETE",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data && data.error ? data.error : "Failed to delete invoice.");
  }
  return data;
}

function setEmptyState(isEmpty) {
  const emptyState = byId("emptyState");
  if (!emptyState) return;
  emptyState.style.display = isEmpty ? "block" : "none";
}

function updateSummary(bills) {
  const totalAmount = bills.reduce((sum, bill) => sum + Number(bill.final_amount || 0), 0);
  const summaryInvoiceCount = byId("summaryInvoiceCount");
  const summaryInvoiceAmount = byId("summaryInvoiceAmount");
  const reportMeta = byId("reportMeta");

  if (summaryInvoiceCount) summaryInvoiceCount.textContent = String(bills.length);
  if (summaryInvoiceAmount) summaryInvoiceAmount.textContent = `Rs ${money0(totalAmount)}`;
  if (reportMeta) reportMeta.textContent = bills.length ? `${bills.length} invoices found.` : "No invoices found.";
}

function actionButtonsHTML(invoiceNo) {
  return `
    <div class="reports-action-group">
      <button class="btn reports-action-btn reports-action-btn--edit editBillBtn" data-invoice-no="${invoiceNo}">Edit</button>
      <button class="btn reports-action-btn reports-action-btn--print printPdfBtn" data-invoice-no="${invoiceNo}">Print</button>
      <button class="btn reports-action-btn reports-action-btn--delete deleteBillBtn" data-invoice-no="${invoiceNo}" aria-label="Delete invoice ${invoiceNo}">&#128465;</button>
    </div>
  `;
}

function bindActionButtons() {
  document.querySelectorAll(".editBillBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const invoiceNo = btn.getAttribute("data-invoice-no");
      window.location.href = `/billing?invoice_no=${encodeURIComponent(invoiceNo)}&mode=edit`;
    });
  });

  document.querySelectorAll(".deleteBillBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const invoiceNo = Number(btn.getAttribute("data-invoice-no"));
      const ok = confirm(`Delete invoice ${invoiceNo}? This cannot be undone.`);
      if (!ok) return;

      try {
        await deleteBill(invoiceNo);
        await onFilter();
      } catch (e) {
        alert(e.message || "Failed to delete invoice.");
      }
    });
  });

  document.querySelectorAll(".printPdfBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const invoiceNo = btn.getAttribute("data-invoice-no");
      const printUrl = `/generate-pdf?invoice_no=${encodeURIComponent(invoiceNo)}&download=0`;
      const w = window.open(printUrl, "_blank");
      if (!w) {
        alert("Popup blocked. Please allow popups for printing.");
        return;
      }
      try {
        w.focus();
      } catch (e) {}
    });
  });
}

function renderBills(bills) {
  const groupsContainer = byId("reportsGroups");
  if (!groupsContainer) {
    console.error("Reports groups container not found: #reportsGroups");
    return;
  }

  groupsContainer.innerHTML = "";
  updateSummary(bills);
  setEmptyState(!bills.length);

  if (!bills.length) {
    return;
  }

  const groups = groupBillsByMonth(bills);
  groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "reports-month-card";

    const rows = group.bills
      .map(
        (bill) => `
          <tr>
            <td data-label="Invoice No">${bill.invoice_no_text || bill.invoice_no}</td>
            <td data-label="Date">${formatDisplayDate(bill.date)}</td>
            <td data-label="Customer">${bill.customer_name || ""}</td>
            <td class="reports-amount-cell" data-label="Invoice Total">Rs ${money0(bill.final_amount)}</td>
            <td data-label="Actions">${actionButtonsHTML(bill.invoice_no)}</td>
          </tr>
        `,
      )
      .join("");

    section.innerHTML = `
      <div class="reports-month-header">${group.label}</div>
      <div class="table-responsive reports-table-wrap">
        <table class="table reports-table">
          <thead>
            <tr>
              <th style="width: 180px;">Invoice No</th>
              <th style="width: 180px;">Date</th>
              <th>Customer</th>
              <th style="width: 180px; text-align: right;">Invoice Total</th>
              <th style="width: 230px; text-align: center;">Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="reports-month-total">${group.label}: Rs ${money0(group.total)}</div>
    `;

    groupsContainer.appendChild(section);
  });

  const grandTotal = bills.reduce((sum, bill) => sum + Number(bill.final_amount || 0), 0);
  const footer = document.createElement("div");
  footer.className = "reports-grand-total";
  footer.textContent = `Grand Total: Rs ${money0(grandTotal)}`;
  groupsContainer.appendChild(footer);

  bindActionButtons();
}

async function onFilter() {
  const fromDate = byId("fromDate");
  const toDate = byId("toDate");
  if (!fromDate || !toDate) return;

  try {
    const bills = await fetchBills(fromDate.value, toDate.value);
    renderBills(bills);
  } catch (e) {
    alert(e.message || "Error loading reports.");
  }
}

async function downloadExcel() {
  const fromDate = byId("fromDate");
  const toDate = byId("toDate");
  if (!fromDate || !toDate) return;

  const params = new URLSearchParams();
  if (fromDate.value) params.append("from", fromDate.value);
  if (toDate.value) params.append("to", toDate.value);

  const url = `/export-excel?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    alert("Failed to download Excel.");
    return;
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "invoices.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function init() {
  const fromDate = byId("fromDate");
  const toDate = byId("toDate");
  const filterBtn = byId("filterBtn");
  const downloadExcelBtn = byId("downloadExcelBtn");

  if (!fromDate || !toDate || !filterBtn || !downloadExcelBtn) {
    console.error("Reports page elements missing. Check reports template markup.");
    return;
  }

  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  fromDate.value = toISODateString(start);
  toDate.value = toISODateString(now);

  filterBtn.addEventListener("click", onFilter);
  downloadExcelBtn.addEventListener("click", downloadExcel);

  onFilter();
}

init();
