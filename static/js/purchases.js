function money2(n) {
  const x = Number(n);
  if (!isFinite(x)) return "0.00";
  return x.toFixed(2);
}

function money3(n) {
  const x = Number(n);
  if (!isFinite(x)) return "0.000";
  return x.toFixed(3);
}

function toast(message, type = "success") {
  window.JewelDeskUI?.toast?.(message, type);
}

const purchaseState = {
  items: [],
  purchases: [],
  editingId: null,
};

function metalFamily(type) {
  return String(type || "").toLowerCase().includes("silver") ? "Silver" : "Gold";
}

function matchesSelectedType(item, selectedType) {
  const normalizedSelected = String(selectedType || "").trim();
  if (!normalizedSelected) return true;
  const itemType = String(item?.metal_type || "").trim();
  return itemType === normalizedSelected;
}

async function fetchInventoryItems() {
  const res = await fetch("/inventory-items");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data && data.error ? data.error : "Failed to load inventory items.");
  return Array.isArray(data.items) ? data.items : [];
}

async function fetchPurchases() {
  const res = await fetch("/purchases-data");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data && data.error ? data.error : "Failed to load purchases.");
  return Array.isArray(data.purchases) ? data.purchases : [];
}

function getItemOptions(type, selected) {
  return purchaseState.items
    .filter((item) => matchesSelectedType(item, type))
    .map(
      (item) => `<option value="${item.item_name}" ${item.item_name === selected ? "selected" : ""}>${item.item_name}</option>`,
    )
    .join("");
}

function renderPurchaseRows(rows) {
  const grid = document.getElementById("purchaseItemsGrid");
  if (!grid) return;

  grid.innerHTML = rows
    .map(
      (row, index) => `
        <div class="purchase-item-row" data-index="${index}">
          <div class="purchase-item-row__cell purchase-item-row__cell--item">
            <label class="purchase-mini-label">Item Name</label>
            <select class="form-select premium-input purchase-item-name">
              <option value="">Select</option>
              ${getItemOptions(row.metal_type, row.item_name)}
            </select>
          </div>
          <div class="purchase-item-row__cell">
            <label class="purchase-mini-label">Type</label>
            <select class="form-select premium-input purchase-item-type">
              <option value="Gold" ${row.metal_type === "Gold" ? "selected" : ""}>Gold</option>
              <option value="Gold Pure" ${row.metal_type === "Gold Pure" ? "selected" : ""}>Gold Pure</option>
              <option value="Silver" ${row.metal_type === "Silver" ? "selected" : ""}>Silver</option>
              <option value="Silver Pure" ${row.metal_type === "Silver Pure" ? "selected" : ""}>Silver Pure</option>
            </select>
          </div>
          <div class="purchase-item-row__cell">
            <label class="purchase-mini-label">Weight (grams)</label>
            <input type="number" min="0" step="0.001" class="form-control premium-input purchase-item-weight" value="${row.weight || ""}" />
          </div>
          <div class="purchase-item-row__cell">
            <label class="purchase-mini-label">Rate</label>
            <input type="number" min="0" step="0.01" class="form-control premium-input purchase-item-rate" value="${row.rate || ""}" />
          </div>
          <div class="purchase-item-row__cell purchase-item-row__cell--remove">
            <button type="button" class="purchase-row-remove" aria-label="Remove item row" title="Remove item row">x</button>
          </div>
        </div>
      `,
    )
    .join("");

  bindPurchaseRowEvents();
  syncPurchaseTotal();
}

function addPurchaseRow(row = {}) {
  const rows = getPurchaseRows();
  rows.push({
    item_name: row.item_name || "",
    metal_type: row.metal_type || "Gold",
    weight: row.weight || "",
    rate: row.rate || "",
  });
  renderPurchaseRows(rows);
}

function removePurchaseRow(index) {
  const rows = getPurchaseRows();
  if (rows.length <= 1) {
    renderPurchaseRows([{ item_name: "", metal_type: "Gold", weight: "", rate: "" }]);
    return;
  }
  rows.splice(index, 1);
  renderPurchaseRows(rows);
}

function getPurchaseRows() {
  return Array.from(document.querySelectorAll(".purchase-item-row")).map((row) => ({
    item_name: row.querySelector(".purchase-item-name").value,
    metal_type: row.querySelector(".purchase-item-type").value,
    weight: row.querySelector(".purchase-item-weight").value,
    rate: row.querySelector(".purchase-item-rate").value,
  }));
}

function syncPurchaseTotal() {
  const total = getPurchaseRows().reduce((sum, row) => sum + Number(row.weight || 0) * Number(row.rate || 0), 0);
  document.getElementById("purchaseTotalText").textContent = `Total Amount: Rs ${money2(total)}`;
}

function bindPurchaseRowEvents() {
  document.querySelectorAll(".purchase-item-row").forEach((row) => {
    const typeSelect = row.querySelector(".purchase-item-type");
    const itemSelect = row.querySelector(".purchase-item-name");
    const removeButton = row.querySelector(".purchase-row-remove");
    const rowIndex = Number(row.dataset.index);

    typeSelect.addEventListener("change", () => {
      const selected = itemSelect.value;
      itemSelect.innerHTML = `<option value="">Select</option>${getItemOptions(typeSelect.value, selected)}`;
      syncPurchaseTotal();
    });

    row.querySelectorAll("select, input").forEach((field) => {
      field.addEventListener("input", syncPurchaseTotal);
      field.addEventListener("change", syncPurchaseTotal);
    });

    if (removeButton) {
      removeButton.addEventListener("click", () => removePurchaseRow(rowIndex));
    }
  });
}

function formatDisplayDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function renderPurchasesTable(purchases) {
  const tbody = document.getElementById("purchasesTableBody");
  const empty = document.getElementById("purchasesEmptyState");
  if (!tbody || !empty) return;

  if (!purchases.length) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  tbody.innerHTML = purchases
    .map(
      (purchase) => `
        <tr>
          <td data-label="Supplier">${purchase.supplier_name}</td>
          <td data-label="Date">${formatDisplayDate(purchase.purchase_date)}</td>
          <td class="text-end" data-label="Total Amount">Rs ${money2(purchase.total_amount)}</td>
          <td class="text-center" data-label="Actions">
            <div class="purchase-action-group">
              <button type="button" class="btn btn-sm purchase-action purchase-action--edit" data-action="edit" data-id="${purchase.id}">Edit</button>
              <button type="button" class="btn btn-sm purchase-action purchase-action--delete" data-action="delete" data-id="${purchase.id}">Delete</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");

  tbody.querySelectorAll("[data-action='edit']").forEach((button) => {
    button.addEventListener("click", () => startEditPurchase(button.dataset.id));
  });

  tbody.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", () => deletePurchase(button.dataset.id));
  });
}

function getValidatedPayload() {
  const supplierName = document.getElementById("supplierName").value.trim();
  const purchaseDate = document.getElementById("purchaseDate").value;
  const rows = getPurchaseRows()
    .filter((row) => row.item_name || row.weight || row.rate)
    .map((row) => ({
      item_name: row.item_name,
      metal_type: row.metal_type,
      weight: Number(row.weight),
      rate: Number(row.rate),
    }));

  if (!supplierName) throw new Error("Supplier Name is required.");
  if (!purchaseDate) throw new Error("Date is required.");
  if (!rows.length) throw new Error("Please add at least one item row.");

  rows.forEach((row, index) => {
    if (!row.item_name || row.weight <= 0 || row.rate <= 0) {
      throw new Error(`Item row #${index + 1} is incomplete.`);
    }
  });

  return {
    supplier_name: supplierName,
    purchase_date: purchaseDate,
    items: rows,
  };
}

async function savePurchase(event) {
  event.preventDefault();
  let payload;
  try {
    payload = getValidatedPayload();
  } catch (error) {
    toast(error.message || "Invalid purchase data.", "error");
    return;
  }

  const url = purchaseState.editingId ? `/purchases/${purchaseState.editingId}` : "/purchases";
  const method = purchaseState.editingId ? "PUT" : "POST";

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data && data.error ? data.error : "Failed to save purchase.");

    toast(purchaseState.editingId ? "Purchase updated successfully." : "Purchase saved successfully.");
    resetPurchaseForm();
    await loadPageData();
  } catch (error) {
    toast(error.message || "Failed to save purchase.", "error");
  }
}

function startEditPurchase(id) {
  const purchase = purchaseState.purchases.find((entry) => entry.id === id);
  if (!purchase) return;

  purchaseState.editingId = id;
  document.getElementById("supplierName").value = purchase.supplier_name || "";
  document.getElementById("purchaseDate").value = formatDisplayDate(purchase.purchase_date);
  renderPurchaseRows(purchase.items || []);
  document.getElementById("savePurchaseBtn").textContent = "Save Purchase";
}

async function deletePurchase(id) {
  window.JewelDeskUI?.confirm?.({
    title: "Delete purchase?",
    message: "This will remove the purchase and roll back its stock weight.",
    confirmText: "Delete",
    onConfirm: async () => {
      try {
        const res = await fetch(`/purchases/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data && data.error ? data.error : "Failed to delete purchase.");
        toast("Purchase deleted successfully.");
        if (purchaseState.editingId === id) resetPurchaseForm();
        await loadPageData();
      } catch (error) {
        toast(error.message || "Failed to delete purchase.", "error");
      }
    },
  });
}

function resetPurchaseForm() {
  purchaseState.editingId = null;
  document.getElementById("purchaseForm").reset();
  document.getElementById("purchaseDate").value = new Date().toISOString().slice(0, 10);
  renderPurchaseRows([{ item_name: "", metal_type: "Gold", weight: "", rate: "" }]);
}

async function loadPageData() {
  const [items, purchases] = await Promise.all([fetchInventoryItems(), fetchPurchases()]);
  purchaseState.items = items;
  purchaseState.purchases = purchases;
  renderPurchasesTable(purchases);
  renderPurchaseRows(getPurchaseRows().length ? getPurchaseRows() : [{ item_name: "", metal_type: "Gold", weight: "", rate: "" }]);
}

function wireStaticActions() {
  document.getElementById("purchaseForm").addEventListener("submit", savePurchase);
  document.getElementById("addPurchaseRowBtn").addEventListener("click", () => addPurchaseRow());
  document.getElementById("purchasePrevBtn").addEventListener("click", () => {
    document.getElementById("purchaseItemsGrid").scrollBy({ left: -220, behavior: "smooth" });
  });
  document.getElementById("purchaseNextBtn").addEventListener("click", () => {
    document.getElementById("purchaseItemsGrid").scrollBy({ left: 220, behavior: "smooth" });
  });
}

async function init() {
  wireStaticActions();
  resetPurchaseForm();
  try {
    await loadPageData();
  } catch (error) {
    toast(error.message || "Failed to load purchases page.", "error");
  }
}

init();
