const DASHBOARD_ENDPOINT = "/dashboard-data";
const BILLS_ENDPOINT = "/bills";
const PURCHASES_ENDPOINT = "/purchases-data";

const byId = (id) => document.getElementById(id);
const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numberFormat = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const quantityFormat = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
const shortDate = new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric" });
const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "short" });

const dashboardState = {
  data: null,
  bills: [],
  purchases: [],
  categoryMetal: "gold",
};

function formatCurrency(value) {
  return currency.format(Number(value || 0));
}

function formatWeight(value) {
  return numberFormat.format(Number(value || 0));
}

function formatQuantity(value) {
  return quantityFormat.format(Number(value || 0));
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
    if (value !== null && value !== undefined && value !== "") search.set(key, value);
  });
  const queryString = search.toString();
  return queryString ? `?${queryString}` : "";
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to load sales data.");
  }
  return response.json();
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

function toDateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseLocalDate(value) {
  if (!value) return null;
  const date = new Date(String(value).includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getSelectedMonthBounds() {
  const monthValue = byId("monthSelector")?.value;
  const today = new Date();
  if (!monthValue) {
    return {
      start: new Date(today.getFullYear(), today.getMonth(), 1),
      end: new Date(today.getFullYear(), today.getMonth() + 1, 0),
    };
  }
  const [year, month] = monthValue.split("-").map(Number);
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 0) };
}

function getRangeBounds(range) {
  const { start, end } = getSelectedMonthBounds();
  if (range === "week") {
    const weekStart = new Date(end);
    weekStart.setDate(end.getDate() - 6);
    return { start: weekStart, end };
  }
  if (range === "year") {
    return { start: new Date(start.getFullYear(), 0, 1), end: new Date(start.getFullYear(), 11, 31) };
  }
  return { start, end };
}

function daysBetween(start, end) {
  const days = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function rangeContains(dateValue, start, end) {
  const date = parseLocalDate(dateValue);
  if (!date) return false;
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return normalized >= start && normalized <= end;
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
      <td data-label="Particulars">${escapeHtml(row.label)}</td>
      <td data-label="Qty" class="text-end">${formatWeight(row.qty)}</td>
      <td data-label="Taxable" class="text-end">${formatCurrency(row.taxable)}</td>
      <td data-label="CGST" class="text-end">${formatCurrency(row.cgst)}</td>
      <td data-label="SGST" class="text-end">${formatCurrency(row.sgst)}</td>
      <td data-label="IGST" class="text-end">${formatCurrency(row.igst)}</td>
      <td data-label="Total" class="text-end">${formatCurrency(row.total)}</td>
    `;
    body.appendChild(tr);
  });
  emptyState.style.display = "none";
}

function getBillAmount(bill) {
  return Number(bill.final_amount ?? bill.total ?? 0);
}

function getPurchaseAmount(purchase) {
  return Number(purchase.total_amount ?? purchase.amount ?? 0);
}

function aggregateByRange(items, range, start, end, amountGetter, dateGetter) {
  if (range === "year") {
    const points = Array.from({ length: 12 }, (_, month) => ({
      key: `${start.getFullYear()}-${String(month + 1).padStart(2, "0")}`,
      label: monthLabel.format(new Date(start.getFullYear(), month, 1)),
      amount: 0,
      count: 0,
      suppliers: new Set(),
      date: new Date(start.getFullYear(), month, 1),
    }));
    items.forEach((item) => {
      const date = parseLocalDate(dateGetter(item));
      if (!date || date < start || date > end) return;
      const point = points[date.getMonth()];
      point.amount += amountGetter(item);
      point.count += 1;
      if (item.supplier_name) point.suppliers.add(item.supplier_name);
    });
    return points.map((point) => ({ ...point, suppliers: point.suppliers.size }));
  }

  const points = daysBetween(start, end).map((date) => ({
    key: toDateInputValue(date),
    label: shortDate.format(date),
    amount: 0,
    count: 0,
    suppliers: new Set(),
    date,
  }));
  const byKey = new Map(points.map((point) => [point.key, point]));
  items.forEach((item) => {
    const date = parseLocalDate(dateGetter(item));
    if (!date) return;
    const key = toDateInputValue(date);
    const point = byKey.get(key);
    if (!point) return;
    point.amount += amountGetter(item);
    point.count += 1;
    if (item.supplier_name) point.suppliers.add(item.supplier_name);
  });
  return points.map((point) => ({ ...point, suppliers: point.suppliers.size }));
}

function calculateGrowth(currentTotal, previousTotal) {
  if (!previousTotal && currentTotal) return 100;
  if (!previousTotal) return 0;
  return ((currentTotal - previousTotal) / previousTotal) * 100;
}

function getPreviousRangeItems(items, range, start, end, dateGetter) {
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  let previousStart = new Date(start);
  if (range === "year") {
    previousStart = new Date(start.getFullYear() - 1, 0, 1);
    previousEnd.setFullYear(start.getFullYear() - 1, 11, 31);
  } else {
    const span = Math.round((end - start) / 86400000);
    previousStart.setDate(start.getDate() - span - 1);
  }
  return items.filter((item) => rangeContains(dateGetter(item), previousStart, previousEnd));
}

function renderGridLines(targetId, width, height, paddingY) {
  const grid = byId(targetId);
  if (!grid) return;
  grid.innerHTML = [0.25, 0.5, 0.75].map((ratio) => {
    const y = paddingY + (height - paddingY * 2) * ratio;
    return `<line x1="28" x2="${width - 28}" y1="${y}" y2="${y}" stroke="rgba(21,33,58,0.07)" stroke-width="1"></line>`;
  }).join("");
}

function positionTooltip(tooltip, left, top, html) {
  if (!tooltip) return;
  tooltip.innerHTML = html;
  tooltip.style.left = left;
  tooltip.style.top = top;
  tooltip.classList.add("is-visible");
}

function hideTooltip(tooltip) {
  tooltip?.classList.remove("is-visible");
}

function renderSalesChart(salesPoints, purchasePoints) {
  const line = byId("salesOverviewLine");
  const area = byId("salesOverviewArea");
  const pointsLayer = byId("salesOverviewPoints");
  const empty = byId("salesOverviewEmpty");
  const tooltip = byId("salesOverviewTooltip");
  if (!line || !area || !pointsLayer || !empty) return;

  const hasData = salesPoints.some((point) => point.amount > 0);
  empty.style.display = hasData ? "none" : "block";
  const width = 680;
  const height = 280;
  const paddingX = 34;
  const paddingY = 26;
  renderGridLines("salesGridLines", width, height, paddingY);
  if (!hasData) {
    line.setAttribute("d", "");
    area.setAttribute("d", "");
    pointsLayer.innerHTML = salesPoints.map((point, index) => {
      const x = salesPoints.length === 1 ? 50 : (index / (salesPoints.length - 1)) * 88 + 6;
      return `
        <span
          class="analytics-point analytics-point--placeholder"
          style="left:${x}%; top:78%;"
          aria-hidden="true">
        </span>
      `;
    }).join("");
    hideTooltip(tooltip);
    return;
  }

  const maxAmount = Math.max(...salesPoints.map((point) => point.amount), 1);
  const stepX = salesPoints.length === 1 ? 0 : (width - paddingX * 2) / (salesPoints.length - 1);
  const coords = salesPoints.map((point, index) => {
    const x = paddingX + index * stepX;
    const y = height - paddingY - (point.amount / maxAmount) * (height - paddingY * 2);
    return { ...point, x, y, purchase: purchasePoints[index]?.amount || 0 };
  });
  const linePath = coords.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(2)} ${height - paddingY} L ${coords[0].x.toFixed(2)} ${height - paddingY} Z`;
  line.setAttribute("d", linePath);
  area.setAttribute("d", areaPath);
  line.style.animation = "none";
  requestAnimationFrame(() => { line.style.animation = ""; });

  pointsLayer.innerHTML = coords.map((point) => `
    <button class="analytics-point" type="button"
      style="left:${(point.x / width) * 100}%; top:${(point.y / height) * 100}%;"
      data-label="${escapeHtml(point.label)}"
      data-sales="${escapeHtml(formatCurrency(point.amount))}"
      data-orders="${point.count}"
      data-profit="${escapeHtml(formatCurrency(point.amount - point.purchase))}"
      aria-label="${escapeHtml(point.label)} sales ${escapeHtml(formatCurrency(point.amount))}">
    </button>
  `).join("");
  pointsLayer.querySelectorAll(".analytics-point").forEach((point) => {
    const show = () => positionTooltip(
      tooltip,
      point.style.left,
      point.style.top,
      `<strong>${point.dataset.label}</strong><span>Sales Amount ${point.dataset.sales}</span><span>Orders Count ${point.dataset.orders}</span><span>Profit ${point.dataset.profit}</span>`
    );
    point.addEventListener("mouseenter", show);
    point.addEventListener("focus", show);
    point.addEventListener("mouseleave", () => hideTooltip(tooltip));
    point.addEventListener("blur", () => hideTooltip(tooltip));
  });
}

function renderPurchaseChart(points) {
  const bars = byId("purchaseOverviewBars");
  const empty = byId("purchaseOverviewEmpty");
  const tooltip = byId("purchaseOverviewTooltip");
  if (!bars || !empty) return;

  const hasData = points.some((point) => point.amount > 0);
  empty.style.display = hasData ? "none" : "block";
  const width = 680;
  const height = 280;
  const paddingX = 34;
  const paddingY = 28;
  renderGridLines("purchaseGridLines", width, height, paddingY);

  const maxAmount = Math.max(...points.map((point) => point.amount), 1);
  const slot = (width - paddingX * 2) / points.length;
  const barWidth = Math.max(10, Math.min(34, slot * 0.58));
  bars.innerHTML = points.map((point, index) => {
    const x = paddingX + index * slot + (slot - barWidth) / 2;
    const barHeight = Math.max(point.amount ? 8 : 2, (point.amount / maxAmount) * (height - paddingY * 2));
    const y = height - paddingY - barHeight;
    const fill = index % 2 === 0 ? "url(#purchaseGoldGradient)" : "url(#purchaseNavyGradient)";
    return `
      <rect class="purchase-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="8"
        fill="${fill}" data-left="${((x + barWidth / 2) / width) * 100}%" data-top="${(y / height) * 100}%"
        data-label="${escapeHtml(point.label)}" data-amount="${escapeHtml(formatCurrency(point.amount))}"
        data-suppliers="${point.suppliers || point.count}" data-date="${escapeHtml(point.key)}"></rect>
    `;
  }).join("");

  bars.querySelectorAll(".purchase-bar").forEach((bar) => {
    const show = () => positionTooltip(
      tooltip,
      bar.dataset.left,
      bar.dataset.top,
      `<strong>${bar.dataset.label}</strong><span>Purchase Amount ${bar.dataset.amount}</span><span>Supplier Count ${bar.dataset.suppliers}</span><span>Purchase Date ${bar.dataset.date}</span>`
    );
    bar.addEventListener("mouseenter", show);
    bar.addEventListener("mouseleave", () => hideTooltip(tooltip));
  });
}

function renderAnalytics() {
  const salesRange = byId("salesRangeSelect")?.value || "month";
  const purchaseRange = byId("purchaseRangeSelect")?.value || "month";
  const salesBounds = getRangeBounds(salesRange);
  const purchaseBounds = getRangeBounds(purchaseRange);
  const salesInRange = dashboardState.bills.filter((bill) => rangeContains(bill.date, salesBounds.start, salesBounds.end));
  const purchasesForSales = dashboardState.purchases.filter((purchase) => rangeContains(purchase.date || purchase.purchase_date, salesBounds.start, salesBounds.end));
  const purchasesInRange = dashboardState.purchases.filter((purchase) => rangeContains(purchase.date || purchase.purchase_date, purchaseBounds.start, purchaseBounds.end));

  const salesPoints = aggregateByRange(salesInRange, salesRange, salesBounds.start, salesBounds.end, getBillAmount, (bill) => bill.date);
  const purchasePointsForSales = aggregateByRange(purchasesForSales, salesRange, salesBounds.start, salesBounds.end, getPurchaseAmount, (purchase) => purchase.date || purchase.purchase_date);
  const purchasePoints = aggregateByRange(purchasesInRange, purchaseRange, purchaseBounds.start, purchaseBounds.end, getPurchaseAmount, (purchase) => purchase.date || purchase.purchase_date);

  const salesTotal = salesInRange.reduce((sum, bill) => sum + getBillAmount(bill), 0);
  const purchaseTotal = purchasesInRange.reduce((sum, purchase) => sum + getPurchaseAmount(purchase), 0);
  const previousSalesTotal = getPreviousRangeItems(dashboardState.bills, salesRange, salesBounds.start, salesBounds.end, (bill) => bill.date)
    .reduce((sum, bill) => sum + getBillAmount(bill), 0);
  const previousPurchaseTotal = getPreviousRangeItems(dashboardState.purchases, purchaseRange, purchaseBounds.start, purchaseBounds.end, (purchase) => purchase.date || purchase.purchase_date)
    .reduce((sum, purchase) => sum + getPurchaseAmount(purchase), 0);

  setText("salesOverviewTotal", formatCurrency(salesTotal));
  setText("salesOverviewGrowth", `${calculateGrowth(salesTotal, previousSalesTotal).toFixed(1)}%`);
  setText("salesOverviewAverage", formatCurrency(salesTotal / Math.max(salesPoints.length, 1)));
  setText("purchaseOverviewTotal", formatCurrency(purchaseTotal));
  setText("purchaseOverviewGrowth", `${calculateGrowth(purchaseTotal, previousPurchaseTotal).toFixed(1)}%`);
  setText("purchaseOverviewAverage", formatCurrency(purchaseTotal / Math.max(purchasesInRange.length, 1)));

  renderSalesChart(salesPoints, purchasePointsForSales);
  renderPurchaseChart(purchasePoints);
  renderTopCategories();
}

function classifyCategory(itemName, metal) {
  const name = String(itemName || "").toLowerCase();
  const prefix = metal === "silver" ? "Silver" : "Gold";
  if (name.includes("necklace") || name.includes("haram")) return `${prefix} Necklace`;
  if (name.includes("ring")) return `${prefix} Ring`;
  if (name.includes("ear") || name.includes("stud")) return `${prefix} Earrings`;
  if (name.includes("chain")) return `${prefix} Chain`;
  if (metal === "gold") return `${prefix} Chain`;
  const cleaned = String(itemName || `${prefix} Jewellery`).replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.replace(/^silver\s*/i, "Silver ") : "Silver Jewellery";
}

function itemMetal(item) {
  return String(item.item_type || item.metal_type || item.particulars || "").toLowerCase().includes("silver") ? "silver" : "gold";
}

function renderTopCategories() {
  const list = byId("categoryList");
  const chart = byId("categoryDonutChart");
  const empty = byId("topItemsEmpty");
  if (!list || !chart || !empty) return;

  const { start, end } = getSelectedMonthBounds();
  const rows = new Map();
  dashboardState.bills
    .filter((bill) => rangeContains(bill.date, start, end))
    .forEach((bill) => {
      (bill.items || []).forEach((item) => {
        const metal = itemMetal(item);
        if (metal !== dashboardState.categoryMetal) return;
        const name = classifyCategory(item.particulars || item.item_name, metal);
        const row = rows.get(name) || { name, revenue: 0, qty: 0 };
        row.revenue += Number(item.invoice_amount ?? item.amount ?? 0);
        row.qty += Number(item.quantity || 0) || 1;
        rows.set(name, row);
      });
    });

  const defaults = dashboardState.categoryMetal === "gold"
    ? ["Gold Necklace", "Gold Ring", "Gold Earrings", "Gold Chain"]
    : [];
  defaults.forEach((name) => rows.set(name, rows.get(name) || { name, revenue: 0, qty: 0 }));

  const categories = [...rows.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const totalRevenue = categories.reduce((sum, row) => sum + row.revenue, 0);
  const totalQty = categories.reduce((sum, row) => sum + row.qty, 0);
  setText("categoryTotalRevenue", formatCurrency(totalRevenue));
  setText("categoryTotalQty", `${formatQuantity(totalQty)} sold`);
  empty.style.display = totalRevenue ? "none" : "block";

  list.innerHTML = categories.map((row, index) => {
    const percent = totalRevenue ? (row.revenue / totalRevenue) * 100 : 0;
    return `
      <article class="category-row" style="--category-color:${getDonutColor(index)}">
        <div class="category-row__mark"></div>
        <div>
          <strong>${escapeHtml(row.name)}</strong>
          <span>${formatCurrency(row.revenue)}</span>
        </div>
        <div class="category-row__metrics">
          <strong>${percent.toFixed(0)}%</strong>
          <span>${formatQuantity(row.qty)} sold</span>
        </div>
      </article>
    `;
  }).join("");
  renderDonut(categories, totalRevenue);
}

function getDonutColor(index) {
  return ["#d4af37", "#243858", "#73b99b", "#c8942f", "#9aa6b8", "#e1c76b"][index % 6];
}

function describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(cx, cy, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(angleInRadians), y: cy + radius * Math.sin(angleInRadians) };
}

function renderDonut(categories, totalRevenue) {
  const chart = byId("categoryDonutChart");
  const tooltip = byId("categoryTooltip");
  if (!chart) return;
  if (!totalRevenue) {
    chart.innerHTML = `<circle cx="130" cy="130" r="82" fill="none" stroke="rgba(21,33,58,0.08)" stroke-width="28"></circle>`;
    return;
  }
  let angle = 0;
  chart.innerHTML = categories.map((row, index) => {
    const slice = (row.revenue / totalRevenue) * 360;
    const path = describeArc(130, 130, 82, angle, angle + slice);
    angle += slice;
    return `<path class="donut-slice" d="${path}" fill="none" stroke="${getDonutColor(index)}" stroke-width="30" stroke-linecap="round"
      data-label="${escapeHtml(row.name)}" data-revenue="${escapeHtml(formatCurrency(row.revenue))}" data-qty="${escapeHtml(formatQuantity(row.qty))} sold"></path>`;
  }).join("");
  chart.querySelectorAll(".donut-slice").forEach((slice) => {
    const show = () => positionTooltip(tooltip, "50%", "15%", `<strong>${slice.dataset.label}</strong><span>${slice.dataset.revenue}</span><span>${slice.dataset.qty}</span>`);
    slice.addEventListener("mouseenter", show);
    slice.addEventListener("mouseleave", () => hideTooltip(tooltip));
  });
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

  const maxWeight = Math.max(...items.map((item) => Number(item.available_weight || 0)), 1);
  body.innerHTML = `
    <div class="inventory-analytics-head" aria-hidden="true">
      <span>Metal Type</span>
      <span>Available Weight</span>
      <span>Stock Health</span>
      <span>Estimated Value</span>
    </div>
    ${items.map((item) => {
    const weight = Number(item.available_weight || 0);
    const ratio = Math.max(0, Math.min(100, (weight / maxWeight) * 100));
    const health = weight <= 0 || ratio < 20 ? "low" : ratio < 50 ? "medium" : "healthy";
    const label = health === "healthy" ? "Healthy" : health === "medium" ? "Medium" : "Low Stock";
    const icon = String(item.metal_type || "").toLowerCase().includes("silver") ? "Ag" : "Au";
    const estimate = weight * estimateMetalRate(item.metal_type);
    return `
      <article class="inventory-analytics-row inventory-analytics-row--${health}">
        <div class="inventory-metal">
          <span class="inventory-metal__icon">${icon}</span>
          <div>
            <strong>${escapeHtml(item.metal_type)}</strong>
            <span>Available Weight</span>
          </div>
        </div>
        <div class="inventory-weight">${formatWeight(weight)} g</div>
        <div class="stock-health">
          <div class="stock-health__bar"><span style="width:${ratio.toFixed(0)}%;"></span></div>
          <strong>${label}</strong>
        </div>
        <div class="inventory-value">${formatCurrency(estimate)}</div>
      </article>
    `;
  }).join("")}
  `;
  empty.style.display = "none";
}

function estimateMetalRate(metalType) {
  const metal = String(metalType || "").toLowerCase().includes("silver") ? "silver" : "gold";
  let revenue = 0;
  let weight = 0;
  dashboardState.bills.forEach((bill) => {
    (bill.items || []).forEach((item) => {
      if (itemMetal(item) !== metal) return;
      revenue += Number(item.invoice_amount ?? item.amount ?? 0);
      weight += Number(item.qty_gms ?? item.weight ?? 0);
    });
  });
  return weight > 0 ? revenue / weight : 0;
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

  const { start, end } = getSelectedMonthBounds();
  const startDate = toDateInputValue(start);
  const endValue = toDateInputValue(end);
  fromDate.value = startDate;
  toDate.value = endValue;
  syncPeriodLabel(startDate);
  if (loader) loader.classList.add("is-visible");

  try {
    const yearStart = `${start.getFullYear()}-01-01`;
    const yearEnd = `${start.getFullYear()}-12-31`;
    const [data, billsPayload, purchasesPayload] = await Promise.all([
      fetchJson(`${DASHBOARD_ENDPOINT}${buildQuery({ from: startDate, to: endValue })}`),
      fetchJson(`${BILLS_ENDPOINT}${buildQuery({ from: yearStart, to: yearEnd })}`),
      fetchJson(PURCHASES_ENDPOINT),
    ]);
    dashboardState.data = data;
    dashboardState.bills = billsPayload.bills || [];
    dashboardState.purchases = purchasesPayload.purchases || [];

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
    renderInventory(data.inventory_snapshot || []);
    renderAnalytics();
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
  monthInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  monthInput.addEventListener("change", loadSalesDashboard);
}

function initializeDashboardControls() {
  byId("salesRangeSelect")?.addEventListener("change", renderAnalytics);
  byId("purchaseRangeSelect")?.addEventListener("change", renderAnalytics);
  byId("categoryToggle")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-metal]");
    if (!button) return;
    dashboardState.categoryMetal = button.dataset.metal;
    byId("categoryToggle")?.querySelectorAll(".category-toggle__btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn === button);
    });
    renderTopCategories();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initializeMonthSelector();
  initializeDashboardControls();
  loadSalesDashboard();
});
