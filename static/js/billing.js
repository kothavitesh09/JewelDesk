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

function getPaymentMode() {
  const bankChecked = document.getElementById("paymentModeBank").checked;
  return bankChecked ? "bank" : "cash";
}

function setPaymentMode(paymentMode) {
  const normalized = paymentMode === "bank" ? "bank" : "cash";
  document.getElementById("paymentModeCash").checked = normalized === "cash";
  document.getElementById("paymentModeBank").checked = normalized === "bank";
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
  const qty = Number(tr.querySelector(".item-qty").value);
  const invoiceAmount = Number(tr.querySelector(".item-amount-input").value);

  const rateCell = tr.querySelector(".item-rate");
  let taxableAmount = 0;
  if (isFinite(invoiceAmount)) {
    taxableAmount = invoiceAmount / 1.03;
  }
  const rate = isFinite(qty) && isFinite(taxableAmount) && qty > 0 ? taxableAmount / qty : 0;
  rateCell.textContent = money2(rate);

  return { invoiceAmount: isFinite(invoiceAmount) ? invoiceAmount : 0, taxableAmount, rate };
}

function readItemsFromDOM() {
  const rows = Array.from(document.querySelectorAll("#itemsTbody tr"));
  return rows.map((tr) => ({
    particulars: tr.querySelector(".item-particulars").value.trim(),
    hsn_code: tr.querySelector(".item-hsn").value.trim(),
    qty_gms: Number(tr.querySelector(".item-qty").value),
    amount: Number(tr.querySelector(".item-amount-input").value),
    rate_per_g: Number(tr.querySelector(".item-rate").textContent || 0),
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
    const amount = Number(tr.querySelector(".item-amount-input").value);
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

  if (taxType === "igst") {
    const rawTotal = invoiceTotal / 1.03;
    igst = Math.round(rawTotal * 0.03 * 100) / 100;
    total = Math.round((invoiceTotal - igst) * 100) / 100;
    finalAmount = Math.round(invoiceTotal * 100) / 100;
  } else {
    const rawTotal = invoiceTotal / 1.03;
    cgst = Math.round(rawTotal * 0.015 * 100) / 100;
    sgst = Math.round(rawTotal * 0.015 * 100) / 100;
    total = Math.round((invoiceTotal - cgst - sgst) * 100) / 100;
    finalAmount = Math.round(invoiceTotal * 100) / 100;
  }

  document.getElementById("totalText").textContent = money2(total);
  document.getElementById("cgstText").textContent = money2(cgst);
  document.getElementById("sgstText").textContent = money2(sgst);
  document.getElementById("igstText").textContent = money2(igst);
  document.getElementById("invoiceTotalText").textContent = money2(finalAmount);

  return { total, cgst, sgst, igst, finalAmount };
}

function bindRowEvents(tr) {
  tr.querySelector(".item-qty").addEventListener("input", () => {
    recalcItemRow(tr);
    recalcTotals();
  });
  tr.querySelector(".item-amount-input").addEventListener("input", () => {
    recalcItemRow(tr);
    recalcTotals();
  });
  tr.querySelector(".removeItemBtn").addEventListener("click", () => {
    tr.remove();
    renderRowIndexes();
    recalcTotals();
    if (document.querySelectorAll("#itemsTbody tr").length === 0) {
      addItemRow();
    }
  });
}

function addItemRow(item = {}, options = {}) {
  const tbody = document.getElementById("itemsTbody");
  const tr = document.createElement("tr");
  const invoiceAmount = item.invoice_amount ?? item.amount ?? "";

  tr.innerHTML = `
    <td class="text-center row-no align-middle">1</td>
    <td class="align-middle">
      <input type="text" class="form-control form-control-sm item-particulars" placeholder="Item name" value="${String(item.particulars || "").replace(/"/g, "&quot;")}" />
    </td>
    <td class="align-middle">
      <input type="text" class="form-control form-control-sm item-hsn" placeholder="HSN" value="${String(item.hsn_code || "").replace(/"/g, "&quot;")}" />
    </td>
    <td class="align-middle">
      <input type="number" min="0" step="0.001" class="form-control form-control-sm item-qty" placeholder="0.000" value="${item.qty_gms ?? ""}" />
    </td>
    <td class="align-middle">
      <input type="number" min="0" step="0.01" class="form-control form-control-sm item-amount-input" placeholder="0.00" value="${invoiceAmount === "" ? "" : Number(invoiceAmount)}" />
    </td>
    <td class="align-middle">
      <span class="item-rate d-inline-block" style="min-width: 90px;">0.00</span>
    </td>
    <td class="text-center align-middle">
      <button type="button" class="btn btn-sm btn-outline-danger removeItemBtn">X</button>
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

  const partyGstNo = document.getElementById("partyGstNo").value.trim();
  const rows = readItemsFromDOM();
  const filtered = [];

  for (const r of rows) {
    const hasAnyField =
      (r.particulars && r.particulars.length) ||
      (r.hsn_code && r.hsn_code.length) ||
      Number.isFinite(r.qty_gms) ||
      Number.isFinite(r.amount);

    if (!hasAnyField) continue;

    const ok = r.particulars && Number(r.qty_gms) > 0 && Number(r.amount) > 0;
    if (!ok) {
      throw new Error("Each added item must have: Particulars, Weight (grams) and Amount.");
    }
    filtered.push(r);
  }

  if (!filtered.length) {
    throw new Error("Please add at least one valid item.");
  }

  return {
    customer_name: customerName,
    party_gst_no: partyGstNo || "",
    payment_mode: getPaymentMode(),
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
}

function setButtonsEnabledAfterInvoice() {
  document.getElementById("downloadPdfBtn").disabled = false;
  document.getElementById("printBillBtn").disabled = false;
  document.getElementById("editBillBtn").disabled = false;
}

function getCurrentInvoiceNo() {
  return window.__CURRENT_INVOICE_NO__ || null;
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
  document.getElementById("partyGstNo").disabled = false;
  document.querySelectorAll("#itemsTbody input, #itemsTbody button").forEach((el) => {
    el.disabled = false;
  });
  document.querySelectorAll("#taxTypeCgstSgst, #taxTypeIgst, #paymentModeCash, #paymentModeBank").forEach((el) => {
    el.disabled = false;
  });
}

function disableEditMode() {
  document.getElementById("addItemBtn").disabled = false;
  document.getElementById("generateBillBtn").style.display = getCurrentInvoiceNo() ? "none" : "inline-block";
  document.getElementById("editBillBtn").style.display = getCurrentInvoiceNo() ? "inline-block" : "none";
  document.getElementById("updateBillBtn").style.display = "none";
  document.getElementById("cancelEditBtn").style.display = "none";
  document.getElementById("invoiceNoInput").disabled = Boolean(getCurrentInvoiceNo());
  document.getElementById("customerName").disabled = false;
  document.getElementById("partyGstNo").disabled = false;
  document.querySelectorAll("#itemsTbody input, #itemsTbody button").forEach((el) => {
    el.disabled = false;
  });
  document.querySelectorAll("#taxTypeCgstSgst, #taxTypeIgst, #paymentModeCash, #paymentModeBank").forEach((el) => {
    el.disabled = false;
  });
}

async function loadBillIntoForm(invoiceNo, options = {}) {
  const bill = typeof invoiceNo === "object" && invoiceNo !== null ? invoiceNo : await fetchBill(invoiceNo);
  document.getElementById("invoiceNoInput").value = bill.invoice_no_text || bill.invoice_no;
  document.getElementById("customerName").value = bill.customer_name || "";
  document.getElementById("partyGstNo").value = bill.party_gst_no || "";
  setPaymentMode(bill.payment_mode || "cash");
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
    alert("No invoice to update.");
    return;
  }

  let payload;
  try {
    payload = getValidatedPayload();
  } catch (e) {
    alert(e.message || "Invalid invoice data.");
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
    alert("Bill updated successfully.");
  } catch (e) {
    alert(e.message || "Error while updating bill.");
  } finally {
    document.getElementById("updateBillBtn").disabled = false;
  }
}

function wireActions() {
  const cgstSgstEl = document.getElementById("taxTypeCgstSgst");
  const igstEl = document.getElementById("taxTypeIgst");
  const paymentCashEl = document.getElementById("paymentModeCash");
  const paymentBankEl = document.getElementById("paymentModeBank");

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
    if (!paymentCashEl.checked && !paymentBankEl.checked) {
      paymentCashEl.checked = true;
    }
    enforcePaymentModeState(paymentCashEl.checked ? "cash" : "bank");
  });

  paymentBankEl.addEventListener("change", () => {
    if (!paymentCashEl.checked && !paymentBankEl.checked) {
      paymentBankEl.checked = true;
    }
    enforcePaymentModeState(paymentBankEl.checked ? "bank" : "cash");
  });

  document.getElementById("addItemBtn").addEventListener("click", () => {
    addItemRow();
    recalcTotals();
  });

  document.getElementById("generateBillBtn").addEventListener("click", async () => {
    let payload;
    try {
      payload = getValidatedPayload();
    } catch (e) {
      alert(e.message || "Invalid invoice data.");
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
      alert("Bill created successfully.");
    } catch (e) {
      alert(e.message || "Error while creating bill.");
    } finally {
      document.getElementById("generateBillBtn").disabled = false;
    }
  });

  document.getElementById("downloadPdfBtn").addEventListener("click", async () => {
    const invoiceNo = getCurrentInvoiceNo();
    if (!invoiceNo) {
      alert("Generate bill first.");
      return;
    }

    const url = `/generate-pdf?invoice_no=${encodeURIComponent(invoiceNo)}&download=1&t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) {
      alert("Failed to download PDF.");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `invoice_${invoiceNo}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  document.getElementById("printBillBtn").addEventListener("click", () => {
    const invoiceNo = getCurrentInvoiceNo();
    if (!invoiceNo) {
      alert("Generate bill first.");
      return;
    }

    const printUrl = `/generate-pdf?invoice_no=${encodeURIComponent(invoiceNo)}&download=0&t=${Date.now()}`;
    const w = window.open(printUrl, "_blank");
    if (!w) {
      alert("Popup blocked. Please allow popups for printing.");
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
  wireActions();
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
    alert(e.message || "Failed to load invoice.");
  }
}

init();
