const reportsById = (id) => document.getElementById(id);

const reportsCurrency = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatReportsCurrency(value) {
  return `Rs ${reportsCurrency.format(Number(value || 0))}`;
}

function formatReportsDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getFullYear()).slice(-2),
  ].join("-");
}

function escapeReportsHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getDefaultRange() {
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - 30);
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

function buildReportsQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

async function fetchReportsBills(fromDate, toDate) {
  const response = await fetch(`/bills${buildReportsQuery({ from: fromDate, to: toDate })}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to load invoices.");
  }
  return Array.isArray(data.bills) ? data.bills : [];
}

function summarizeBills(bills) {
  return bills.reduce(
    (summary, bill) => {
      summary.count += 1;
      summary.amount += Number(bill.final_amount || 0);
      return summary;
    },
    { count: 0, amount: 0 }
  );
}

function groupBillsByMonth(bills) {
  const groups = new Map();

  bills.forEach((bill) => {
    const date = new Date(bill.date || "");
    const key = Number.isNaN(date.getTime())
      ? "0000-00"
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const title = Number.isNaN(date.getTime())
      ? "Unknown"
      : date.toLocaleString("en-IN", { month: "long", year: "numeric" });

    if (!groups.has(key)) {
      groups.set(key, { key, title, bills: [], total: 0 });
    }

    const group = groups.get(key);
    group.bills.push(bill);
    group.total += Number(bill.final_amount || 0);
  });

  return Array.from(groups.values())
    .sort((left, right) => right.key.localeCompare(left.key))
    .map((group) => ({
      ...group,
      bills: group.bills.sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0)),
    }));
}

function renderReportsSummary(summary) {
  const reportsCountText = reportsById("reportsCountText");
  const summaryInvoicesValue = reportsById("summaryInvoicesValue");
  const summaryAmountValue = reportsById("summaryAmountValue");

  if (reportsCountText) {
    reportsCountText.textContent = `${summary.count} invoice${summary.count === 1 ? "" : "s"} found.`;
  }
  if (summaryInvoicesValue) {
    summaryInvoicesValue.textContent = String(summary.count);
  }
  if (summaryAmountValue) {
    summaryAmountValue.textContent = formatReportsCurrency(summary.amount);
  }
}

function buildReportRow(bill) {
  const invoiceNo = bill.invoice_no_text || bill.invoice_no || "-";
  return `
    <tr>
      <td data-label="Invoice No">${escapeReportsHtml(invoiceNo)}</td>
      <td data-label="Date">${escapeReportsHtml(formatReportsDate(bill.date))}</td>
      <td data-label="Customer">${escapeReportsHtml(bill.customer_name || "Walk-in Customer")}</td>
      <td data-label="Invoice Total" class="text-end reports-list-amount">${escapeReportsHtml(formatReportsCurrency(bill.final_amount || 0))}</td>
      <td data-label="Actions" class="reports-list-actions">
        <button type="button" class="reports-action-btn reports-action-btn--edit" data-action="edit" data-invoice-no="${escapeReportsHtml(bill.invoice_no)}">Edit</button>
        <button type="button" class="reports-action-btn reports-action-btn--print" data-action="print" data-invoice-no="${escapeReportsHtml(bill.invoice_no)}">Print</button>
        <button type="button" class="reports-action-btn reports-action-btn--delete" data-action="delete" data-invoice-no="${escapeReportsHtml(bill.invoice_no)}" aria-label="Delete invoice ${escapeReportsHtml(invoiceNo)}">&#128465;</button>
      </td>
    </tr>
  `;
}

function renderReportsGroups(bills) {
  const groupsContainer = reportsById("salesReportGroups");
  const emptyState = reportsById("salesReportsEmptyState");
  if (!groupsContainer || !emptyState) return;

  if (!bills.length) {
    groupsContainer.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }

  groupsContainer.innerHTML = groupBillsByMonth(bills)
    .map(
      (group) => `
        <section class="reports-month-card reports-month-card--list">
          <div class="reports-month-card__header">
            <h3>${escapeReportsHtml(group.title)}</h3>
          </div>
          <div class="table-responsive premium-table-wrap">
            <table class="table reports-table reports-list-table">
              <thead>
                <tr>
                  <th>Invoice No</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th class="text-end">Invoice Total</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${group.bills.map((bill) => buildReportRow(bill)).join("")}</tbody>
            </table>
          </div>
          <div class="reports-month-card__footer">${escapeReportsHtml(group.title)}: ${escapeReportsHtml(formatReportsCurrency(group.total))}</div>
        </section>
      `
    )
    .join("");

  emptyState.style.display = "none";
}

async function loadReports() {
  const fromDate = reportsById("salesFromDate")?.value || "";
  const toDate = reportsById("salesToDate")?.value || "";
  const loading = reportsById("salesReportsLoading");

  if (loading) {
    loading.classList.add("is-visible");
  }

  try {
    const bills = await fetchReportsBills(fromDate, toDate);
    renderReportsSummary(summarizeBills(bills));
    renderReportsGroups(bills);
  } catch (error) {
    renderReportsSummary({ count: 0, amount: 0 });
    renderReportsGroups([]);
    window.JewelDeskUI?.toast?.(error.message || "Failed to load invoices.", "error");
  } finally {
    if (loading) {
      loading.classList.remove("is-visible");
    }
  }
}

function downloadReportsExcel() {
  const fromDate = reportsById("salesFromDate")?.value || "";
  const toDate = reportsById("salesToDate")?.value || "";
  window.location.href = `/export-excel${buildReportsQuery({ from: fromDate, to: toDate })}`;
}

function editInvoice(invoiceNo) {
  if (!invoiceNo) return;
  window.location.href = `/billing?invoice_no=${encodeURIComponent(invoiceNo)}&mode=edit`;
}

function buildPdfUrl(invoiceNo) {
  const params = new URLSearchParams({
    invoice_no: String(invoiceNo),
    download: "0",
    t: String(Date.now()),
  });

  const branding = window.__JEWELDESK_USER_BRANDING__ || {};
  const logoPath = branding.logo_path || "";
  const shopNameImagePath = branding.shop_name_image_path || "";
  const shopName = branding.shop_name || "";

  if (logoPath) params.set("logo_path", logoPath);
  if (shopNameImagePath) params.set("shop_name_image_path", shopNameImagePath);
  if (shopName) params.set("shop_name", shopName);

  return `/generate-pdf?${params.toString()}`;
}

function printInvoice(invoiceNo) {
  if (!invoiceNo) return;
  const printUrl = buildPdfUrl(invoiceNo);
  const popup = window.open(printUrl, "_blank");
  if (!popup) {
    window.JewelDeskUI?.toast?.("Popup blocked. Please allow popups for printing.", "error");
  }
}

async function deleteInvoice(invoiceNo) {
  if (!invoiceNo) return;

  const performDelete = async () => {
    try {
      const response = await fetch(`/bills/${encodeURIComponent(invoiceNo)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete invoice.");
      }
      window.JewelDeskUI?.toast?.("Invoice deleted successfully.", "success");
      await loadReports();
    } catch (error) {
      window.JewelDeskUI?.toast?.(error.message || "Failed to delete invoice.", "error");
    }
  };

  window.JewelDeskUI?.confirm?.({
    title: "Delete invoice?",
    message: `Invoice ${invoiceNo} will be removed permanently.`,
    confirmText: "Delete",
    onConfirm: performDelete,
  });
}

function handleReportsAction(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const action = actionButton.getAttribute("data-action");
  const invoiceNo = actionButton.getAttribute("data-invoice-no");

  if (action === "edit") {
    editInvoice(invoiceNo);
  } else if (action === "print") {
    printInvoice(invoiceNo);
  } else if (action === "delete") {
    deleteInvoice(invoiceNo);
  }
}

function initializeReportsPage() {
  const fromInput = reportsById("salesFromDate");
  const toInput = reportsById("salesToDate");
  const showInvoicesBtn = reportsById("showInvoicesBtn");
  const downloadExcelBtn = reportsById("downloadExcelBtn");
  const reportsGroups = reportsById("salesReportGroups");

  if (!fromInput || !toInput || !showInvoicesBtn || !downloadExcelBtn || !reportsGroups) return;

  const defaults = getDefaultRange();
  fromInput.value = defaults.from;
  toInput.value = defaults.to;

  showInvoicesBtn.addEventListener("click", loadReports);
  downloadExcelBtn.addEventListener("click", downloadReportsExcel);
  reportsGroups.addEventListener("click", handleReportsAction);

  loadReports();
}

document.addEventListener("DOMContentLoaded", initializeReportsPage);
