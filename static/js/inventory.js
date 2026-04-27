function money3(n) {
  const x = Number(n);
  if (!isFinite(x)) return "0.000";
  return x.toFixed(3);
}

function toast(message, type = "success") {
  window.JewelDeskUI?.toast?.(message, type);
}

const inventoryState = {
  activeType: "Gold",
  items: [],
};

async function fetchInventoryItems(search = "") {
  const params = new URLSearchParams();
  if (search) params.append("search", search);
  const res = await fetch(`/inventory-items?${params.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data && data.error ? data.error : "Failed to load inventory.");
  return Array.isArray(data.items) ? data.items : [];
}

function renderMasterList() {
  const list = document.getElementById("inventoryMasterList");
  const filtered = inventoryState.items.filter((item) => item.metal_type === inventoryState.activeType);
  document.getElementById("inventoryListTitle").textContent = `${inventoryState.activeType} Items`;
  document.getElementById("inventoryListCount").textContent = `${filtered.length} Items`;

  list.innerHTML = filtered.length
    ? filtered
        .map(
          (item) => `
            <div class="inventory-master-item">
              <span>${item.item_name}</span>
              <div class="inventory-master-item__actions">
                <button type="button" class="inventory-master-item__edit" data-edit-id="${item.id}" data-name="${item.item_name}">Edit</button>
                <button type="button" class="inventory-master-item__delete" data-id="${item.id}">X</button>
              </div>
            </div>
          `,
        )
        .join("")
    : `<div class="reports-empty-state reports-empty-state--inline" style="display:block;">No ${inventoryState.activeType.toLowerCase()} items yet.</div>`;

  list.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => deleteInventoryItem(button.dataset.id));
  });
  list.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => editInventoryItem(button.dataset.editId, button.dataset.name));
  });
}

function renderSnapshot() {
  const tbody = document.getElementById("inventorySnapshotBody");
  const empty = document.getElementById("inventorySnapshotEmptyState");
  const search = document.getElementById("inventorySearch").value.trim().toLowerCase();
  const rows = inventoryState.items.filter(
    (item) =>
      item.metal_type === inventoryState.activeType &&
      item.item_name.toLowerCase().includes(search),
  );

  if (!rows.length) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  tbody.innerHTML = rows
    .map(
      (item) => `
        <tr class="${Number(item.available_weight || 0) < 0 ? "inventory-row--negative" : ""}">
          <td data-label="Item Name">${item.item_name}</td>
          <td data-label="Type">${item.metal_type}</td>
          <td class="text-end" data-label="Total Weight (grams)">${money3(item.available_weight)}</td>
          <td data-label="Last Updated">${(item.updated_at || "").slice(0, 10)}</td>
        </tr>
      `,
    )
    .join("");
}

async function createInventoryItem() {
  const input = document.getElementById("inventoryItemName");
  const itemName = input.value.trim();
  if (!itemName) {
    toast("Item Name is required.", "error");
    return;
  }

  try {
    const res = await fetch("/inventory-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_name: itemName, metal_type: inventoryState.activeType }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data && data.error ? data.error : "Failed to add item.");
    input.value = "";
    toast("Inventory item added successfully.");
    await loadInventory();
  } catch (error) {
    toast(error.message || "Failed to add item.", "error");
  }
}

async function editInventoryItem(id, currentName) {
  window.JewelDeskUI?.prompt?.({
    title: "Edit item name",
    message: `Update the ${inventoryState.activeType} item name.`,
    initialValue: currentName || "",
    placeholder: "Item name",
    confirmText: "Save",
    onConfirm: async (nextName) => {
      const itemName = String(nextName || "").trim();
      if (!itemName) {
        toast("Item Name is required.", "error");
        return;
      }

      try {
        const res = await fetch(`/inventory-items/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_name: itemName }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data && data.error ? data.error : "Failed to update item.");
        toast("Inventory item updated successfully.");
        await loadInventory();
      } catch (error) {
        toast(error.message || "Failed to update item.", "error");
      }
    },
  });
}

async function deleteInventoryItem(id) {
  window.JewelDeskUI?.confirm?.({
    title: "Delete item?",
    message: "This removes the item master from Inventory.",
    confirmText: "Delete",
    onConfirm: async () => {
      try {
        const res = await fetch(`/inventory-items/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data && data.error ? data.error : "Failed to delete item.");
        toast("Inventory item deleted successfully.");
        await loadInventory();
      } catch (error) {
        toast(error.message || "Failed to delete item.", "error");
      }
    },
  });
}

async function loadInventory() {
  inventoryState.items = await fetchInventoryItems();
  renderMasterList();
  renderSnapshot();
}

function wireActions() {
  document.querySelectorAll("#inventoryTypeTabs .inventory-tab").forEach((button) => {
    button.addEventListener("click", () => {
      inventoryState.activeType = button.dataset.type;
      document.querySelectorAll("#inventoryTypeTabs .inventory-tab").forEach((tab) => {
        tab.classList.toggle("is-active", tab === button);
      });
      renderMasterList();
      renderSnapshot();
    });
  });

  document.getElementById("addInventoryItemBtn").addEventListener("click", createInventoryItem);
  document.getElementById("inventorySearch").addEventListener("input", renderSnapshot);
}

async function init() {
  wireActions();
  try {
    await loadInventory();
  } catch (error) {
    toast(error.message || "Failed to load inventory page.", "error");
  }
}

init();
