const DASHBOARD_ENDPOINT = "/dashboard-data";

const byId = (id) => document.getElementById(id);
const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormat = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const dateLabel = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  day: "numeric",
});

function formatCurrency(value) {
  return currency.format(Number(value || 0));
}

function formatWeight(value) {
  return numberFormat.format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, value);
    }
  });
  const queryString = search.toString();
  return queryString ? `?${queryString}` : "";
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to load sales data.");
  }
  return response.json();
}

function setText(id, value) {
  const element = byId(id);
  if (element) {
    element.textContent = value;
  }
}

function setTrendMeta(id, current, previous, label) {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  let copy = `${label} is steady compared to yesterday`;
  if (currentValue > previousValue) {
    copy = `${label} is up ${formatCurrency(currentValue - previousValue)} from yesterday`;
  } else if (currentValue < previousValue) {
    copy = `${label} is down ${formatCurrency(previousValue - currentValue)} from yesterday`;
  }
  setText(id, copy);
}

function renderAbstractTable(rows) {
  const body = byId("abstractTableBody");
  const emptyState = byId("emptyState");
  if (!body || !emptyState) return;

  body.innerHTML = "";
  if (!rows || !rows.length) {
    emptyState.style.display = "block";
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.label)}</td>
      <td class="text-end">${formatWeight(row.qty)}</td>
      <td class="text-end">${formatCurrency(row.taxable)}</td>
      <td class="text-end">${formatCurrency(row.cgst)}</td>
      <td class="text-end">${formatCurrency(row.sgst)}</td>
      <td class="text-end">${formatCurrency(row.igst)}</td>
      <td class="text-end">${formatCurrency(row.total)}</td>
    `;
    body.appendChild(tr);
  });
  emptyState.style.display = "none";
}

function renderTopItems(items) {
  const list = byId("topItemsList");
  const empty = byId("topItemsEmpty");
  if (!list || !empty) return;

  if (!items || !items.length) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  list.innerHTML = items
    .map(
      (item) => `
        <div class="top-items-list__item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <div>${formatWeight(item.qty)} g sold</div>
          </div>
          <div>${formatCurrency(item.revenue)}</div>
        </div>
      `
    )
    .join("");
  empty.style.display = "none";
}

function renderInventory(items) {
  const body = byId("inventoryTableBody");
  const empty = byId("inventoryEmptyState");
  if (!body || !empty) return;

  if (!items || !items.length) {
    body.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  body.innerHTML = items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.item_name)}</td>
          <td class="text-end">${formatWeight(item.available_weight)} g</td>
          <td class="text-end">${escapeHtml(item.status)}</td>
        </tr>
      `
    )
    .join("");
  empty.style.display = "none";
}

function renderRecentList(targetId, items, emptyLabel) {
  const container = byId(targetId);
  if (!container) return;

  container.innerHTML = items && items.length
    ? items
        .map(
          (item) => `
            <div class="recent-transaction-card">
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <div>${escapeHtml(item.id)}</div>
              </div>
              <div>${formatCurrency(item.amount)}</div>
            </div>
          `
        )
        .join("")
    : `<div class="reports-empty-state reports-empty-state--inline" style="display:block;">${emptyLabel}</div>`;
}

function renderLowStockAlerts(items) {
  const container = byId("lowStockAlerts");
  const empty = byId("lowStockEmptyState");
  if (!container || !empty) return;

  if (!items || !items.length) {
    container.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  container.innerHTML = items
    .map(
      (item) => `
        <article class="alert-card">
          <strong>${escapeHtml(item.item_name)}</strong>
          <div>${formatWeight(item.available_weight)} g available</div>
          <span>${escapeHtml(item.status)}</span>
        </article>
      `
    )
    .join("");
  empty.style.display = "none";
}

function renderTrendChart(points) {
  const svg = byId("trendChart");
  const line = byId("trendLine");
  const area = byId("trendArea");
  const shell = byId("trendChartShell");
  const empty = byId("trendChartEmpty");
  const pointsLayer = byId("trendPoints");
  const tooltip = byId("trendTooltip");
  if (!svg || !line || !area || !shell || !empty || !pointsLayer || !tooltip) return;

  if (!points || !points.length) {
    line.setAttribute("d", "");
    area.setAttribute("d", "");
    pointsLayer.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  const width = 640;
  const height = 240;
  const paddingX = 28;
  const paddingY = 20;
  const maxAmount = Math.max(...points.map((point) => Number(point.amount || 0)), 1);
  const stepX = points.length === 1 ? 0 : (width - paddingX * 2) / (points.length - 1);

  const coordinates = points.map((point, index) => {
    const amount = Number(point.amount || 0);
    const x = paddingX + index * stepX;
    const y = height - paddingY - (amount / maxAmount) * (height - paddingY * 2);
    return { x, y, amount, date: point.date };
  });

  const linePath = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${coordinates[coordinates.length - 1].x.toFixed(2)} ${(height - paddingY).toFixed(2)} L ${coordinates[0].x.toFixed(2)} ${(height - paddingY).toFixed(2)} Z`;

  line.setAttribute("d", linePath);
  area.setAttribute("d", areaPath);
  empty.style.display = "none";

  pointsLayer.innerHTML = coordinates
    .map(
      (point) => `
        <button
          type="button"
          class="trend-point"
          style="left:${(point.x / width) * 100}%; top:${(point.y / height) * 100}%;"
          data-date="${escapeHtml(point.date)}"
          data-amount="${escapeHtml(formatCurrency(point.amount))}"
          aria-label="${escapeHtml(point.date)} ${escapeHtml(formatCurrency(point.amount))}"
        ></button>
      `
    )
    .join("");

  const showTooltip = (event) => {
    const target = event.currentTarget;
    tooltip.textContent = `${target.dataset.date}: ${target.dataset.amount}`;
    tooltip.style.opacity = "1";
    tooltip.style.left = target.style.left;
    tooltip.style.top = target.style.top;
  };

  const hideTooltip = () => {
    tooltip.style.opacity = "0";
  };

  pointsLayer.querySelectorAll(".trend-point").forEach((point) => {
    point.addEventListener("mouseenter", showTooltip);
    point.addEventListener("focus", showTooltip);
    point.addEventListener("mouseleave", hideTooltip);
    point.addEventListener("blur", hideTooltip);
  });
}

function syncPeriodLabel(fromDate) {
  const label = byId("turnoverPeriodText");
  if (!label || !fromDate) return;

  const date = new Date(`${fromDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return;
  const month = date.toLocaleString("en-IN", { month: "short" });
  const year = String(date.getFullYear()).slice(-2);
  label.textContent = `Total Turnover: ${month}-${year}`;
}

async function loadSalesDashboard() {
  const monthInput = byId("monthSelector");
  const fromDate = byId("fromDate");
  const toDate = byId("toDate");
  const loader = byId("reportsLoading");

  if (!monthInput || !fromDate || !toDate) return;

  const monthValue = monthInput.value;
  if (!monthValue) return;
  const [year, month] = monthValue.split("-");
  const startDate = `${year}-${month}-01`;
  const endDate = new Date(Number(year), Number(month), 0);
  const endValue = `${year}-${month}-${String(endDate.getDate()).padStart(2, "0")}`;

  fromDate.value = startDate;
  toDate.value = endValue;
  syncPeriodLabel(startDate);

  if (loader) loader.classList.add("is-visible");

  try {
    const data = await fetchJson(`${DASHBOARD_ENDPOINT}${buildQuery({ from: startDate, to: endValue })}`);
    setText("shopNameText", data.branding?.shop_name || window.__JEWELDESK_USER_BRANDING__?.shop_name || "JewelDesk");

    setText("salesAmountValue", formatCurrency(data.kpis?.today_sales));
    setText("purchaseAmountValue", formatCurrency(data.kpis?.today_purchases));
    setText("stockWeightValue", formatWeight(data.kpis?.total_stock_weight));
    setText("alertCountValue", String(data.kpis?.low_stock_alerts || 0));

    setTrendMeta("salesTrendValue", data.kpis?.today_sales, data.kpis?.today_sales_previous, "Sales");
    setTrendMeta("purchaseTrendValue", data.kpis?.today_purchases, data.kpis?.today_purchases_previous, "Purchases");
    setText("stockMetaValue", "Available metal weight on hand");
    setText("alertSummaryValue", `${data.kpis?.low_stock_alerts || 0} items below the stock threshold`);

    renderAbstractTable(data.monthly_summary || []);
    setText("bankAmountValue", formatCurrency(data.payment_summary?.bank));
    setText("cashAmountValue", formatCurrency(data.payment_summary?.cash));
    setText("paymentTotalValue", formatCurrency(data.payment_summary?.total));
    renderTopItems(data.top_selling_items || []);
    renderInventory(data.inventory_snapshot || []);
    renderRecentList("recentSalesList", data.recent_sales || [], "No sales yet.");
    renderRecentList("recentPurchasesList", data.recent_purchases || [], "No purchases yet.");
    renderLowStockAlerts(data.low_stock_alerts || []);
    renderTrendChart(data.sales_trend || []);
  } catch (error) {
    window.JewelDeskUI?.toast?.(error.message || "Unable to load sales data.", "error");
  } finally {
    if (loader) loader.classList.remove("is-visible");
  }
}

function initializeMonthSelector() {
  const monthInput = byId("monthSelector");
  if (!monthInput) return;

  const today = new Date();
  const monthValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  monthInput.value = monthValue;
  monthInput.addEventListener("change", () => {
    loadSalesDashboard();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initializeMonthSelector();
  loadSalesDashboard();
});
