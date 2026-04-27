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

window.__INVENTORY_ITEM_OPTIONS__ = [];

function metalFamily(type) {
  return String(type || "").toLowerCase().includes("silver") ? "Silver" : "Gold";
}

function matchesSelectedType(item, selectedType) {
  const normalizedSelected = String(selectedType || "").trim();
  if (!normalizedSelected) return true;
  const itemType = String(item?.metal_type || "").trim();
  return itemType === normalizedSelected;
}

async function loadInventoryOptions() {
  try {
    const res = await fetch("/inventory-items");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data && data.error ? data.error : "Failed to load inventory items.");
    }
    window.__INVENTORY_ITEM_OPTIONS__ = Array.isArray(data.items) ? data.items : [];
    ensureItemDatalist();
  } catch (error) {
    window.__INVENTORY_ITEM_OPTIONS__ = [];
  }
}

function ensureItemDatalist() {
  let datalist = document.getElementById("billingItemOptions");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "billingItemOptions";
    document.body.appendChild(datalist);
  }

  datalist.innerHTML = (window.__INVENTORY_ITEM_OPTIONS__ || [])
    .map((item) => `<option value="${String(item.item_name || "").replace(/"/g, "&quot;")}"></option>`)
    .join("");
}

function getBillingItemOptions(type, selected) {
  const matchingItems = (window.__INVENTORY_ITEM_OPTIONS__ || []).filter(
    (item) => matchesSelectedType(item, type),
  );
  const hasSelected = selected && matchingItems.some((item) => item.item_name === selected);
  const selectedOption = hasSelected || !selected
    ? ""
    : `<option value="${String(selected).replace(/"/g, "&quot;")}" selected>${String(selected).replace(/"/g, "&quot;")}</option>`;

  return `${selectedOption}<option value="">Select item</option>${matchingItems
    .map((item) => {
      const itemName = String(item.item_name || "");
      const escapedItemName = itemName.replace(/"/g, "&quot;");
      return `<option value="${escapedItemName}" ${itemName === selected ? "selected" : ""}>${escapedItemName}</option>`;
    })
    .join("")}`;
}

function setValueIfPresent(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.value = value ?? "";
  }
}

function formatDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function todayDateInputValue() {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
}

function ensureInvoiceDate() {
  const input = document.getElementById("invoiceDateInput");
  if (input && !input.value) {
    input.value = todayDateInputValue();
  }
}

function updateBillingMeta(summary = {}) {
  const rows = Array.from(document.querySelectorAll("#itemsTbody tr"));
  const itemCount = rows.length;
  const taxType = getTaxType() === "igst" ? "IGST" : "CGST + SGST";

  const itemCountBadge = document.getElementById("itemCountBadge");
  const heroItemCount = document.getElementById("heroItemCount");
  const heroTaxType = document.getElementById("heroTaxType");
  const heroInvoiceTotalText = document.getElementById("heroInvoiceTotalText");
  const previewTaxableAmount = document.getElementById("previewTaxableAmount");
  const previewGstAmount = document.getElementById("previewGstAmount");
  const previewGrandTotal = document.getElementById("previewGrandTotal");
  const itemsEmptyState = document.getElementById("itemsEmptyState");

  const itemLabel = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  if (itemCountBadge) itemCountBadge.textContent = itemLabel;
  if (heroItemCount) heroItemCount.textContent = itemLabel;
  if (heroTaxType) heroTaxType.textContent = taxType;
  if (heroInvoiceTotalText) heroInvoiceTotalText.textContent = money2(summary.finalAmount || 0);
  if (previewTaxableAmount) previewTaxableAmount.textContent = money2(summary.total || 0);
  if (previewGstAmount) previewGstAmount.textContent = money2((summary.cgst || 0) + (summary.sgst || 0) + (summary.igst || 0));
  if (previewGrandTotal) previewGrandTotal.textContent = money2(summary.finalAmount || 0);
  if (itemsEmptyState) itemsEmptyState.style.display = itemCount ? "none" : "block";
}

function getPaymentMode() {
  const cashBankChecked = document.getElementById("paymentModeCashBank").checked;
  const bankChecked = document.getElementById("paymentModeBank").checked;
  if (cashBankChecked) return "cash_bank";
  return bankChecked ? "bank" : "cash";
}

function setPaymentMode(paymentMode) {
  const normalized = paymentMode === "bank" || paymentMode === "cash_bank" ? paymentMode : "cash";
  document.getElementById("paymentModeCash").checked = normalized === "cash";
  document.getElementById("paymentModeBank").checked = normalized === "bank";
  document.getElementById("paymentModeCashBank").checked = normalized === "cash_bank";
  toggleSplitPaymentFields(normalized);
}

function toggleSplitPaymentFields(paymentMode) {
  const splitPaymentFields = document.getElementById("splitPaymentFields");
  const cashAmountInput = document.getElementById("cashAmountInput");
  const bankAmountInput = document.getElementById("bankAmountInput");
  const isSplitPayment = paymentMode === "cash_bank";

  splitPaymentFields.style.display = isSplitPayment ? "block" : "none";
  cashAmountInput.disabled = !isSplitPayment;
  bankAmountInput.disabled = !isSplitPayment;

  if (!isSplitPayment) {
    cashAmountInput.value = "";
    bankAmountInput.value = "";
  }
}

function getTaxType() {
  const igstChecked = document.getElementById("taxTypeIgst").checked;
  return igstChecked ? "igst" : "cgst_sgst";
}

function setTaxType(taxType) {
  const normalized = taxType === "igst" ? "igst" : "cgst_sgst";
  document.getElementById("taxTypeCgstSgst").checked = normalized === "cgst_sgst";
  document.getElementById("taxTypeIgst").checked = normalized === "igst";
}

function recalcItemRow(tr) {
  const grossWeight = Number(tr.querySelector(".item-gross-weight").value);
  const stoneWeight = Number(tr.querySelector(".item-stone-weight").value);
  const netWeightInput = tr.querySelector(".item-net-weight");
  const netWeightValue = Number(netWeightInput.value);
  const valueAddition = Number(tr.querySelector(".item-value-addition").value);
  const rate = Number(tr.querySelector(".item-rate-input").value);
  const stoneAmount = Number(tr.querySelector(".item-stone-amount").value);
  const netAmountInput = tr.querySelector(".item-net-amount");

  const safeGrossWeight = isFinite(grossWeight) ? grossWeight : 0;
  const safeStoneWeight = isFinite(stoneWeight) ? stoneWeight : 0;
  const derivedNetWeight = Math.max(safeGrossWeight - safeStoneWeight, 0);
  const safeNetWeight = isFinite(netWeightValue) && netWeightValue > 0 ? netWeightValue : derivedNetWeight;
  const safeValueAddition = isFinite(valueAddition) ? valueAddition : 0;
  const safeRate = isFinite(rate) ? rate : 0;
  const safeStoneAmount = isFinite(stoneAmount) ? stoneAmount : 0;
  const computedNetAmount = Math.round((((safeNetWeight + safeValueAddition) * safeRate) + safeStoneAmount) * 100) / 100;

  if (document.activeElement !== netWeightInput) {
    netWeightInput.value = safeNetWeight > 0 ? money3(safeNetWeight) : "";
  }

  netAmountInput.value = computedNetAmount > 0 ? money2(computedNetAmount) : "";

  const invoiceAmount = computedNetAmount;
  let taxableAmount = 0;
  if (isFinite(invoiceAmount) && invoiceAmount > 0) {
    taxableAmount = invoiceAmount / 1.03;
  }

  return {
    invoiceAmount: isFinite(invoiceAmount) ? invoiceAmount : 0,
    taxableAmount,
    netWeight: safeNetWeight,
    rate: safeRate,
  };
}

function readItemsFromDOM() {
  const rows = Array.from(document.querySelectorAll("#itemsTbody tr"));
  return rows.map((tr) => ({
    particulars: tr.querySelector(".item-particulars").value.trim(),
    item_type: tr.querySelector(".item-type").value.trim(),
    quantity: Number(tr.querySelector(".item-quantity").value),
    gross_weight: Number(tr.querySelector(".item-gross-weight").value),
    stone_weight: Number(tr.querySelector(".item-stone-weight").value),
    qty_gms: Number(tr.querySelector(".item-net-weight").value),
    value_addition: Number(tr.querySelector(".item-value-addition").value),
    amount: Number(tr.querySelector(".item-net-amount").value),
    rate_per_g: Number(tr.querySelector(".item-rate-input").value),
    stone_amount: Number(tr.querySelector(".item-stone-amount").value),
  }));
}

function renderRowIndexes() {
  const rows = Array.from(document.querySelectorAll("#itemsTbody tr"));
  rows.forEach((tr, idx) => {
    tr.querySelector(".row-no").textContent = String(idx + 1);
  });
}

function recalcTotals() {
  const rows = Array.from(document.querySelectorAll("#itemsTbody tr"));
  let invoiceTotal = 0;
  const taxType = getTaxType();

  rows.forEach((tr) => {
    const amount = Number(tr.querySelector(".item-net-amount").value);
    if (isFinite(amount) && amount > 0) {
      invoiceTotal += amount;
    }
  });

  invoiceTotal = Math.round(invoiceTotal * 100) / 100;
  let total = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let finalAmount = 0;

  total = invoiceTotal;
  if (taxType === "igst") {
    igst = Math.round(total * 0.03 * 100) / 100;
  } else {
    cgst = Math.round(total * 0.015 * 100) / 100;
    sgst = Math.round(total * 0.015 * 100) / 100;
  }
  finalAmount = Math.round((total + cgst + sgst + igst) * 100) / 100;

  document.getElementById("totalText").textContent = money2(total);
  document.getElementById("cgstText").textContent = money2(cgst);
  document.getElementById("sgstText").textContent = money2(sgst);
  document.getElementById("igstText").textContent = money2(igst);
  document.getElementById("invoiceTotalText").textContent = money2(finalAmount);
  const summary = { total, cgst, sgst, igst, finalAmount };
  updateBillingMeta(summary);
  return summary;
}

function bindRowEvents(tr) {
  const typeSelect = tr.querySelector(".item-type");
  const descriptionSelect = tr.querySelector(".item-particulars");

  typeSelect.addEventListener("change", () => {
    const selected = descriptionSelect.value;
    descriptionSelect.innerHTML = getBillingItemOptions(typeSelect.value, selected);
    recalcItemRow(tr);
    recalcTotals();
  });

  tr.querySelectorAll(".item-quantity, .item-gross-weight, .item-stone-weight, .item-value-addition, .item-rate-input, .item-stone-amount, .item-net-amount, .item-net-weight, .item-type, .item-particulars").forEach((input) => {
    input.addEventListener("input", () => {
      recalcItemRow(tr);
      recalcTotals();
    });
    input.addEventListener("change", () => {
      recalcItemRow(tr);
      recalcTotals();
    });
  });
  tr.querySelector(".removeItemBtn").addEventListener("click", () => {
    tr.remove();
    renderRowIndexes();
    if (document.querySelectorAll("#itemsTbody tr").length === 0) {
      addItemRow();
    }
    recalcTotals();
  });
}

function addItemRow(item = {}, options = {}) {
  const tbody = document.getElementById("itemsTbody");
  const tr = document.createElement("tr");
  const itemType = String(item.item_type || "Gold");
  const quantity = item.quantity ?? "";
  const grossWeight = item.gross_weight ?? item.qty_gms ?? "";
  const stoneWeight = item.stone_weight ?? "";
  const netWeight = item.qty_gms ?? "";
  const valueAddition = item.value_addition ?? "";
  const ratePerG = item.rate_per_g ?? "";
  const stoneAmount = item.stone_amount ?? "";
  const invoiceAmount = item.invoice_amount ?? item.amount ?? "";

  tr.innerHTML = `
    <td class="text-center row-no align-middle" data-label="S. No">1</td>
    <td class="align-middle" data-label="Description">
      <select class="form-select form-select-sm item-particulars">
        ${getBillingItemOptions(itemType, String(item.particulars || ""))}
      </select>
    </td>
    <td class="align-middle" data-label="Type">
      <select class="form-select form-select-sm item-type">
        <option value="Gold" ${itemType === "Gold" ? "selected" : ""}>Gold</option>
        <option value="Gold Pure" ${itemType === "Gold Pure" ? "selected" : ""}>Gold Pure</option>
        <option value="Silver" ${itemType === "Silver" ? "selected" : ""}>Silver</option>
        <option value="Silver Pure" ${itemType === "Silver Pure" ? "selected" : ""}>Silver Pure</option>
      </select>
    </td>
    <td class="align-middle" data-label="Qty">
      <input type="number" min="0" step="1" class="form-control form-control-sm item-quantity" placeholder="0" value="${quantity}" />
    </td>
    <td class="align-middle" data-label="GR WT">
      <input type="number" min="0" step="0.001" class="form-control form-control-sm item-gross-weight" placeholder="0.000" value="${grossWeight}" />
    </td>
    <td class="align-middle" data-label="ST. WT">
      <input type="number" min="0" step="0.001" class="form-control form-control-sm item-stone-weight" placeholder="0.000" value="${stoneWeight}" />
    </td>
    <td class="align-middle" data-label="NET WT">
      <input type="number" min="0" step="0.001" class="form-control form-control-sm item-net-weight" placeholder="0.000" value="${netWeight}" />
    </td>
    <td class="align-middle" data-label="VA.">
      <input type="number" min="0" step="0.001" class="form-control form-control-sm item-value-addition" placeholder="0.000" value="${valueAddition}" />
    </td>
    <td class="align-middle" data-label="Rate">
      <input type="number" min="0" step="0.01" class="form-control form-control-sm item-rate-input" placeholder="0.00" value="${ratePerG}" />
    </td>
    <td class="align-middle" data-label="ST AMT">
      <input type="number" min="0" step="0.01" class="form-control form-control-sm item-stone-amount" placeholder="0.00" value="${stoneAmount}" />
    </td>
    <td class="align-middle" data-label="NET AMT (Rs.)">
      <input type="number" min="0" step="0.01" class="form-control form-control-sm item-net-amount" placeholder="0.00" value="${invoiceAmount === "" ? "" : Number(invoiceAmount)}" readonly />
    </td>
    <td class="text-center align-middle" data-label="Action">
      <button type="button" class="btn btn-sm btn-outline-danger removeItemBtn" aria-label="Remove item">&#128465;</button>
    </td>
  `;

  tbody.appendChild(tr);
  bindRowEvents(tr);
  recalcItemRow(tr);
  renderRowIndexes();

  if (options.editable === false) {
    tr.querySelectorAll("input, button").forEach((el) => {
      el.disabled = true;
    });
  }

  return tr;
}

function clearItems() {
  document.getElementById("itemsTbody").innerHTML = "";
}

function getValidatedPayload() {
  const customerName = document.getElementById("customerName").value.trim();
  if (!customerName) {
    throw new Error("Customer Name is required.");
  }

  const customerAddress = document.getElementById("customerAddress").value.trim();
  const customerPhone = document.getElementById("customerPhone").value.trim();
  const partyGstNo = document.getElementById("partyGstNo").value.trim();
  const invoiceDate = document.getElementById("invoiceDateInput").value;
  const rows = readItemsFromDOM();
  const filtered = [];

  if (!invoiceDate) {
    throw new Error("Date is required.");
  }

  for (const r of rows) {
    const hasAnyField =
      (r.particulars && r.particulars.length) ||
      (r.item_type && r.item_type.length) ||
      Number.isFinite(r.quantity) ||
      Number.isFinite(r.gross_weight) ||
      Number.isFinite(r.stone_weight) ||
      Number.isFinite(r.qty_gms) ||
      Number.isFinite(r.value_addition) ||
      Number.isFinite(r.amount);

    if (!hasAnyField) continue;

    const ok = r.particulars && Number(r.qty_gms) > 0 && Number(r.amount) > 0;
    if (!ok) {
      throw new Error("Each added item must have: Description, Net Weight, and Net Amount.");
    }
    filtered.push(r);
  }

  if (!filtered.length) {
    throw new Error("Please add at least one valid item.");
  }

  const summary = recalcTotals();
  const paymentMode = getPaymentMode();
  let cashAmount = null;
  let bankAmount = null;

  if (paymentMode === "cash_bank") {
    cashAmount = Number(document.getElementById("cashAmountInput").value);
    bankAmount = Number(document.getElementById("bankAmountInput").value);

    if (!isFinite(cashAmount) || cashAmount <= 0) {
      throw new Error("Cash amount must be greater than 0 for Cash + Bank.");
    }
    if (!isFinite(bankAmount) || bankAmount <= 0) {
      throw new Error("Bank amount must be greater than 0 for Cash + Bank.");
    }

    const splitTotal = Math.round((cashAmount + bankAmount) * 100) / 100;
    const finalAmount = Math.round(Number(summary.finalAmount || 0) * 100) / 100;
    if (splitTotal !== finalAmount) {
      throw new Error("Cash amount + Bank amount must equal the invoice total.");
    }
  }

  return {
    customer_name: customerName,
    customer_address: customerAddress || "",
    customer_phone: customerPhone || "",
    party_gst_no: partyGstNo || "",
    invoice_date: invoiceDate,
    payment_mode: paymentMode,
    cash_amount: cashAmount,
    bank_amount: bankAmount,
    items: filtered,
    tax_type: getTaxType(),
  };
}

async function postCreateBill(payload) {
  const res = await fetch("/create-bill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data && data.error ? data.error : "Failed to create bill.");
  }
  return data;
}

async function fetchBill(invoiceNo) {
  const res = await fetch(`/bills/${encodeURIComponent(invoiceNo)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data && data.error ? data.error : "Failed to load invoice.");
  }
  return data;
}

function applyBillSummary(bill) {
  window.__CURRENT_INVOICE_NO__ = String(bill.invoice_no);
  window.__ORIGINAL_BILL__ = JSON.parse(JSON.stringify(bill));
  document.getElementById("invoiceNoText").textContent = bill.invoice_no_text || String(bill.invoice_no);
  document.getElementById("totalText").textContent = money2(bill.total);
  document.getElementById("cgstText").textContent = money2(bill.cgst);
  document.getElementById("sgstText").textContent = money2(bill.sgst);
  document.getElementById("igstText").textContent = money2(bill.igst || 0);
  document.getElementById("invoiceTotalText").textContent = money2(bill.final_amount);
  updateBillingMeta({
    total: bill.total,
    cgst: bill.cgst,
    sgst: bill.sgst,
    igst: bill.igst || 0,
    finalAmount: bill.final_amount,
  });
}

function setButtonsEnabledAfterInvoice() {
  document.getElementById("downloadPdfBtn").disabled = false;
  document.getElementById("printBillBtn").disabled = false;
  document.getElementById("editBillBtn").disabled = false;
}

function getCurrentInvoiceNo() {
  return window.__CURRENT_INVOICE_NO__ || null;
}

function buildPdfUrl(invoiceNo, download) {
  const params = new URLSearchParams({
    invoice_no: String(invoiceNo),
    download: download ? "1" : "0",
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

function getEditQueryInvoiceNo() {
  const params = new URLSearchParams(window.location.search);
  return params.get("invoice_no");
}

function shouldStartInEditMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("mode") === "edit";
}

window.__CURRENT_INVOICE_NO__ = null;
window.__ORIGINAL_BILL__ = null;

function enableEditMode() {
  document.getElementById("addItemBtn").disabled = false;
  document.getElementById("generateBillBtn").style.display = "none";
  document.getElementById("editBillBtn").style.display = "none";
  document.getElementById("updateBillBtn").style.display = "inline-block";
  document.getElementById("cancelEditBtn").style.display = "inline-block";
  document.getElementById("invoiceNoInput").disabled = true;
  document.getElementById("customerName").disabled = false;
  document.getElementById("customerAddress").disabled = false;
  document.getElementById("customerPhone").disabled = false;
  document.getElementById("partyGstNo").disabled = false;
  document.querySelectorAll("#itemsTbody input, #itemsTbody button").forEach((el) => {
    el.disabled = false;
  });
  document.querySelectorAll("#taxTypeCgstSgst, #taxTypeIgst, #paymentModeCash, #paymentModeBank, #paymentModeCashBank, #cashAmountInput, #bankAmountInput").forEach((el) => {
    el.disabled = false;
  });
  toggleSplitPaymentFields(getPaymentMode());
}

function disableEditMode() {
  document.getElementById("addItemBtn").disabled = false;
  document.getElementById("generateBillBtn").style.display = getCurrentInvoiceNo() ? "none" : "inline-block";
  document.getElementById("editBillBtn").style.display = getCurrentInvoiceNo() ? "inline-block" : "none";
  document.getElementById("updateBillBtn").style.display = "none";
  document.getElementById("cancelEditBtn").style.display = "none";
  document.getElementById("invoiceNoInput").disabled = Boolean(getCurrentInvoiceNo());
  document.getElementById("customerName").disabled = false;
  document.getElementById("customerAddress").disabled = false;
  document.getElementById("customerPhone").disabled = false;
  document.getElementById("partyGstNo").disabled = false;
  document.querySelectorAll("#itemsTbody input, #itemsTbody button").forEach((el) => {
    el.disabled = false;
  });
  document.querySelectorAll("#taxTypeCgstSgst, #taxTypeIgst, #paymentModeCash, #paymentModeBank, #paymentModeCashBank, #cashAmountInput, #bankAmountInput").forEach((el) => {
    el.disabled = false;
  });
  toggleSplitPaymentFields(getPaymentMode());
}

async function loadBillIntoForm(invoiceNo, options = {}) {
  const bill = typeof invoiceNo === "object" && invoiceNo !== null ? invoiceNo : await fetchBill(invoiceNo);
  document.getElementById("invoiceNoInput").value = bill.invoice_no_text || bill.invoice_no;
  setValueIfPresent("invoiceDateInput", formatDateInputValue(bill.date) || todayDateInputValue());
  document.getElementById("customerName").value = bill.customer_name || "";
  setValueIfPresent("customerAddress", bill.customer_address || "");
  setValueIfPresent("customerPhone", bill.customer_phone || "");
  document.getElementById("partyGstNo").value = bill.party_gst_no || "";
  setPaymentMode(bill.payment_mode || "cash");
  setValueIfPresent("cashAmountInput", bill.cash_amount ?? "");
  setValueIfPresent("bankAmountInput", bill.bank_amount ?? "");
  setTaxType(bill.tax_type || "cgst_sgst");

  clearItems();
  const items = Array.isArray(bill.items) && bill.items.length ? bill.items : [{}];
  items.forEach((item) => addItemRow(item, { editable: true }));
  recalcTotals();
  applyBillSummary(bill);
  setButtonsEnabledAfterInvoice();

  if (options.editMode) {
    enableEditMode();
  } else {
    disableEditMode();
  }
}

async function updateCurrentBill() {
  const invoiceNo = getCurrentInvoiceNo();
  if (!invoiceNo) {
    toast("No invoice to update.", "error");
    return;
  }

  let payload;
  try {
    payload = getValidatedPayload();
  } catch (e) {
    toast(e.message || "Invalid invoice data.", "error");
    return;
  }

  try {
    document.getElementById("updateBillBtn").disabled = true;
    const res = await fetch(`/bills/${encodeURIComponent(invoiceNo)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const updated = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(updated && updated.error ? updated.error : "Update failed.");
    }

    await loadBillIntoForm(updated, { editMode: false });
    toast("Bill updated successfully.", "success");
  } catch (e) {
    toast(e.message || "Error while updating bill.", "error");
  } finally {
    document.getElementById("updateBillBtn").disabled = false;
  }
}

function wireActions() {
  const cgstSgstEl = document.getElementById("taxTypeCgstSgst");
  const igstEl = document.getElementById("taxTypeIgst");
  const paymentCashEl = document.getElementById("paymentModeCash");
  const paymentBankEl = document.getElementById("paymentModeBank");
  const paymentCashBankEl = document.getElementById("paymentModeCashBank");

  function enforceTaxTypeState(source) {
    setTaxType(source);
    Array.from(document.querySelectorAll("#itemsTbody tr")).forEach((tr) => recalcItemRow(tr));
    recalcTotals();
  }

  cgstSgstEl.addEventListener("change", () => {
    if (!cgstSgstEl.checked && !igstEl.checked) {
      cgstSgstEl.checked = true;
    }
    enforceTaxTypeState(cgstSgstEl.checked ? "cgst_sgst" : "igst");
  });

  igstEl.addEventListener("change", () => {
    if (!cgstSgstEl.checked && !igstEl.checked) {
      igstEl.checked = true;
    }
    enforceTaxTypeState(igstEl.checked ? "igst" : "cgst_sgst");
  });

  function enforcePaymentModeState(source) {
    setPaymentMode(source);
  }

  paymentCashEl.addEventListener("change", () => {
    if (!paymentCashEl.checked && !paymentBankEl.checked && !paymentCashBankEl.checked) {
      paymentCashEl.checked = true;
    }
    if (paymentCashEl.checked) {
      enforcePaymentModeState("cash");
    } else if (paymentBankEl.checked) {
      enforcePaymentModeState("bank");
    } else {
      enforcePaymentModeState("cash_bank");
    }
  });

  paymentBankEl.addEventListener("change", () => {
    if (!paymentCashEl.checked && !paymentBankEl.checked && !paymentCashBankEl.checked) {
      paymentBankEl.checked = true;
    }
    if (paymentBankEl.checked) {
      enforcePaymentModeState("bank");
    } else if (paymentCashBankEl.checked) {
      enforcePaymentModeState("cash_bank");
    } else {
      enforcePaymentModeState("cash");
    }
  });

  paymentCashBankEl.addEventListener("change", () => {
    if (!paymentCashEl.checked && !paymentBankEl.checked && !paymentCashBankEl.checked) {
      paymentCashBankEl.checked = true;
    }
    if (paymentCashBankEl.checked) {
      enforcePaymentModeState("cash_bank");
    } else if (paymentBankEl.checked) {
      enforcePaymentModeState("bank");
    } else {
      enforcePaymentModeState("cash");
    }
  });

  document.getElementById("addItemBtn").addEventListener("click", () => {
    addItemRow();
    recalcTotals();
    toast("New item row added.", "info");
  });

  const downloadExcelBtn = document.getElementById("downloadExcelBtn");
  if (downloadExcelBtn) {
    downloadExcelBtn.addEventListener("click", () => {
      window.location.href = `/export-excel?t=${Date.now()}`;
    });
  }

  document.getElementById("generateBillBtn").addEventListener("click", async () => {
    let payload;
    try {
      payload = getValidatedPayload();
    } catch (e) {
      toast(e.message || "Invalid invoice data.", "error");
      return;
    }

    const invoiceNoInput = document.getElementById("invoiceNoInput").value.trim();
    if (invoiceNoInput) {
      payload.invoice_no = invoiceNoInput;
    }

    try {
      document.getElementById("generateBillBtn").disabled = true;
      const created = await postCreateBill(payload);
      await loadBillIntoForm(created, { editMode: false });
      toast("Bill created successfully.", "success");
    } catch (e) {
      toast(e.message || "Error while creating bill.", "error");
    } finally {
      document.getElementById("generateBillBtn").disabled = false;
    }
  });

  document.getElementById("downloadPdfBtn").addEventListener("click", async () => {
    const invoiceNo = getCurrentInvoiceNo();
    if (!invoiceNo) {
      toast("Generate bill first.", "error");
      return;
    }

    const url = buildPdfUrl(invoiceNo, true);
    const res = await fetch(url);
    if (!res.ok) {
      toast("Failed to download PDF.", "error");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `invoice_${invoiceNo}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("PDF download started.", "success");
  });

  document.getElementById("printBillBtn").addEventListener("click", () => {
    const invoiceNo = getCurrentInvoiceNo();
    if (!invoiceNo) {
      toast("Generate bill first.", "error");
      return;
    }

    const printUrl = buildPdfUrl(invoiceNo, false);
    const w = window.open(printUrl, "_blank");
    if (!w) {
      toast("Popup blocked. Please allow popups for printing.", "error");
      return;
    }
    try {
      w.focus();
    } catch (e) {}
  });

  document.getElementById("editBillBtn").addEventListener("click", () => {
    enableEditMode();
  });

  document.getElementById("updateBillBtn").addEventListener("click", async () => {
    await updateCurrentBill();
  });

  document.getElementById("cancelEditBtn").addEventListener("click", async () => {
    if (window.__ORIGINAL_BILL__) {
      await loadBillIntoForm(window.__ORIGINAL_BILL__, { editMode: false });
      return;
    }
    disableEditMode();
  });
}

async function init() {
  await loadInventoryOptions();
  wireActions();
  ensureInvoiceDate();
  addItemRow();
  recalcTotals();
  disableEditMode();

  const invoiceNo = getEditQueryInvoiceNo();
  if (!invoiceNo) {
    return;
  }

  try {
    await loadBillIntoForm(invoiceNo, { editMode: shouldStartInEditMode() });
  } catch (e) {
    toast(e.message || "Failed to load invoice.", "error");
  }
}

init();
