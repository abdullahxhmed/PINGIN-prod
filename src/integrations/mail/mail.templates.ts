import type {
  AdminOrderCreatedEmailData,
  AdminOrderPaidEmailData,
  StockAlertData,
  AdminCustomNotificationData,
} from "./mail.types.js";

// Helper for consistent HTML layout wrapper
const wrapHtmlEmail = (title: string, bodyContent: string): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      line-height: 1.5;
    }
    .wrapper {
      width: 100%;
      background-color: #f1f5f9;
      padding: 32px 12px;
      box-sizing: border-box;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      background-color: #0f172a;
      padding: 24px 28px;
      text-align: left;
    }
    .brand-name {
      color: #38bdf8;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin: 0;
    }
    .brand-sub {
      color: #94a3b8;
      font-size: 13px;
      margin: 4px 0 0 0;
    }
    .content {
      padding: 28px;
    }
    .footer {
      background-color: #f8fafc;
      padding: 18px 28px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #64748b;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-amber {
      background-color: #fef3c7;
      color: #b45309;
    }
    .badge-emerald {
      background-color: #d1fae5;
      color: #065f46;
    }
    .badge-rose {
      background-color: #ffe4e6;
      color: #9f1239;
    }
    .badge-blue {
      background-color: #e0f2fe;
      color: #0369a1;
    }
    .info-card {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      margin-top: 18px;
    }
    .table-container {
      margin-top: 20px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }
    th {
      background-color: #f8fafc;
      color: #475569;
      font-weight: 600;
      padding: 10px 14px;
      border-bottom: 1px solid #e2e8f0;
    }
    td {
      padding: 12px 14px;
      border-bottom: 1px solid #f1f5f9;
      color: #1e293b;
    }
    tr:last-child td {
      border-bottom: none;
    }
    .stat-grid {
      display: table;
      width: 100%;
      margin: 18px 0;
    }
    .stat-cell {
      display: table-cell;
      width: 50%;
      padding: 12px;
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      vertical-align: top;
      box-sizing: border-box;
    }
    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 700;
      color: #64748b;
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
    }
    .btn {
      display: inline-block;
      background-color: #0284c7;
      color: #ffffff !important;
      font-weight: 600;
      padding: 10px 20px;
      border-radius: 6px;
      text-decoration: none;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1 class="brand-name">PARKPING</h1>
        <p class="brand-sub">Admin Operations &amp; Event Notification</p>
      </div>
      <div class="content">
        ${bodyContent}
      </div>
      <div class="footer">
        <p style="margin: 0;">Automated email from ParkPing Server System. Confidential &amp; Internal Use Only.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
};

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrice(amount: number, currency: string = "INR"): string {
  const formatted = amount.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  return currency === "INR" ? `₹${formatted}` : `${currency} ${formatted}`;
}

/**
 * Render email for new order creation (checkout placed).
 */
export const renderOrderCreatedEmail = (
  data: AdminOrderCreatedEmailData
): { subject: string; html: string; text: string } => {
  const subject = `[ParkPing] 🛒 New Order Created: #${data.orderNumber} (${formatPrice(data.totalAmount, data.currency)})`;

  const itemRowsHtml = data.items
    .map(
      (item) => `
    <tr>
      <td><strong>${escapeHtml(item.variantName)}</strong>${item.sku ? `<br/><small style="color: #64748b;">SKU: ${escapeHtml(item.sku)}</small>` : ""}</td>
      <td style="text-align: center;">${item.quantity}</td>
      <td style="text-align: right;">${formatPrice(item.unitPrice, data.currency)}</td>
      <td style="text-align: right; font-weight: 600;">${formatPrice(item.totalPrice, data.currency)}</td>
    </tr>`
    )
    .join("");

  const addr = data.shippingAddress;
  const addressHtml = `
    <strong>${escapeHtml(addr.fullName)}</strong><br/>
    Phone: ${escapeHtml(addr.phoneNumber)}<br/>
    ${escapeHtml(addr.addressLine1)}<br/>
    ${addr.addressLine2 ? `${escapeHtml(addr.addressLine2)}<br/>` : ""}
    ${escapeHtml(addr.city)}, ${escapeHtml(addr.state)} - ${escapeHtml(addr.postalCode)}<br/>
    ${escapeHtml(addr.country)}
  `;

  const createdDate = data.createdAt ? new Date(data.createdAt).toLocaleString("en-IN") : new Date().toLocaleString("en-IN");

  const bodyContent = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <div>
        <h2 style="margin: 0; font-size: 20px; color: #0f172a;">New Order Received</h2>
        <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">Placed at: ${createdDate}</p>
      </div>
      <div style="text-align: right;">
        <span class="badge badge-amber">${escapeHtml(data.status)}</span>
      </div>
    </div>

    <table style="width: 100%; margin: 16px 0;">
      <tr>
        <td style="width: 50%; padding: 0 8px 0 0; vertical-align: top;">
          <div class="stat-cell" style="width: 100%;">
            <div class="stat-label">Order Reference</div>
            <div class="stat-value" style="font-size: 16px;">#${escapeHtml(data.orderNumber)}</div>
            ${data.razorpayOrderId ? `<div style="font-size: 12px; color: #64748b; margin-top: 4px;">Razorpay Order: ${escapeHtml(data.razorpayOrderId)}</div>` : ""}
          </div>
        </td>
        <td style="width: 50%; padding: 0 0 0 8px; vertical-align: top;">
          <div class="stat-cell" style="width: 100%;">
            <div class="stat-label">Order Total</div>
            <div class="stat-value" style="color: #0369a1;">${formatPrice(data.totalAmount, data.currency)}</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${data.items.length} item(s)</div>
          </div>
        </td>
      </tr>
    </table>

    <div class="info-card">
      <h3 style="margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #334155;">Customer &amp; Shipping Details</h3>
      <table style="width: 100%; border: none;">
        <tr>
          <td style="width: 50%; padding: 4px 0; border: none; vertical-align: top;">
            <strong style="color: #475569;">Contact:</strong><br/>
            Email: ${data.customerEmail ? `<a href="mailto:${escapeHtml(data.customerEmail)}" style="color: #0284c7;">${escapeHtml(data.customerEmail)}</a>` : "N/A"}<br/>
            Phone: ${data.customerPhone ? escapeHtml(data.customerPhone) : "N/A"}
          </td>
          <td style="width: 50%; padding: 4px 0; border: none; vertical-align: top;">
            <strong style="color: #475569;">Shipping Destination:</strong><br/>
            ${addressHtml}
          </td>
        </tr>
      </table>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Item / Variant</th>
            <th style="text-align: center;">Qty</th>
            <th style="text-align: right;">Unit Price</th>
            <th style="text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRowsHtml}
        </tbody>
        <tfoot>
          <tr style="background-color: #f8fafc; font-weight: 700;">
            <td colspan="3" style="text-align: right; border-top: 1px solid #e2e8f0;">Total:</td>
            <td style="text-align: right; border-top: 1px solid #e2e8f0; color: #0284c7; font-size: 14px;">
              ${formatPrice(data.totalAmount, data.currency)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  const textLines = [
    `PARKPING ADMIN NOTIFICATION: NEW ORDER CREATED`,
    `===============================================`,
    `Order Number: #${data.orderNumber}`,
    `Order ID: ${data.orderId}`,
    `Status: ${data.status}`,
    `Total Amount: ${formatPrice(data.totalAmount, data.currency)}`,
    `Date: ${createdDate}`,
    ``,
    `CUSTOMER:`,
    `Email: ${data.customerEmail || "N/A"}`,
    `Phone: ${data.customerPhone || "N/A"}`,
    ``,
    `SHIPPING ADDRESS:`,
    `${addr.fullName}`,
    `Phone: ${addr.phoneNumber}`,
    `${addr.addressLine1}`,
    addr.addressLine2 ? `${addr.addressLine2}` : "",
    `${addr.city}, ${addr.state} - ${addr.postalCode}`,
    `${addr.country}`,
    ``,
    `ITEMS:`,
    ...data.items.map(
      (item) =>
        `- ${item.variantName} (Qty: ${item.quantity}) @ ${formatPrice(item.unitPrice, data.currency)} = ${formatPrice(item.totalPrice, data.currency)}`
    ),
    ``,
    `Total: ${formatPrice(data.totalAmount, data.currency)}`,
  ].filter(Boolean);

  return {
    subject,
    html: wrapHtmlEmail(subject, bodyContent),
    text: textLines.join("\n"),
  };
};

/**
 * Render email for verified order payment.
 */
export const renderOrderPaidEmail = (
  data: AdminOrderPaidEmailData
): { subject: string; html: string; text: string } => {
  const subject = `[ParkPing] 💰 Order Paid: #${data.orderNumber} (${formatPrice(data.totalAmount, data.currency)})`;

  const paidDate = data.paidAt ? new Date(data.paidAt).toLocaleString("en-IN") : new Date().toLocaleString("en-IN");

  const itemsHtml = data.items && data.items.length > 0
    ? `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Item / Variant</th>
              <th style="text-align: center;">Qty</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${data.items
              .map(
                (i) => `
              <tr>
                <td><strong>${escapeHtml(i.variantName)}</strong></td>
                <td style="text-align: center;">${i.quantity}</td>
                <td style="text-align: right; font-weight: 600;">${formatPrice(i.totalPrice, data.currency)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : "";

  const bodyContent = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <div>
        <h2 style="margin: 0; font-size: 20px; color: #065f46;">Payment Successfully Captured</h2>
        <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">Confirmed at: ${paidDate}</p>
      </div>
      <div>
        <span class="badge badge-emerald">PAID</span>
      </div>
    </div>

    <table style="width: 100%; margin: 16px 0;">
      <tr>
        <td style="width: 50%; padding: 0 8px 0 0; vertical-align: top;">
          <div class="stat-cell" style="width: 100%;">
            <div class="stat-label">Order Number</div>
            <div class="stat-value" style="font-size: 16px;">#${escapeHtml(data.orderNumber)}</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Payment ID: ${escapeHtml(data.providerPaymentId)}</div>
          </div>
        </td>
        <td style="width: 50%; padding: 0 0 0 8px; vertical-align: top;">
          <div class="stat-cell" style="width: 100%;">
            <div class="stat-label">Amount Paid</div>
            <div class="stat-value" style="color: #059669;">${formatPrice(data.totalAmount, data.currency)}</div>
            <div style="font-size: 12px; color: #059669; margin-top: 4px;">Reconciled &amp; Ready for Packing</div>
          </div>
        </td>
      </tr>
    </table>

    <div class="info-card">
      <h3 style="margin: 0 0 8px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #334155;">Customer Contact</h3>
      <p style="margin: 0; font-size: 14px;">
        Email: ${data.customerEmail ? `<a href="mailto:${escapeHtml(data.customerEmail)}" style="color: #0284c7;">${escapeHtml(data.customerEmail)}</a>` : "N/A"}<br/>
        Phone: ${data.customerPhone ? escapeHtml(data.customerPhone) : "N/A"}
      </p>
    </div>

    ${itemsHtml}

    <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
      ℹ️ Commercial inventory has been deducted and an automated fulfillment job (<code>FULFILL_ORDER</code>) has been queued.
    </p>
  `;

  const textLines = [
    `PARKPING ADMIN NOTIFICATION: PAYMENT RECEIVED`,
    `===============================================`,
    `Order Number: #${data.orderNumber}`,
    `Amount: ${formatPrice(data.totalAmount, data.currency)}`,
    `Razorpay Payment ID: ${data.providerPaymentId}`,
    `Customer: ${data.customerEmail || "N/A"} (${data.customerPhone || "N/A"})`,
    `Paid At: ${paidDate}`,
    `Status: Order is PAID and queued for warehouse packing.`,
  ];

  return {
    subject,
    html: wrapHtmlEmail(subject, bodyContent),
    text: textLines.join("\n"),
  };
};

/**
 * Render single low-stock or out-of-stock alert email.
 */
export const renderStockAlertEmail = (
  alert: StockAlertData
): { subject: string; html: string; text: string } => {
  const isOutOfStock = alert.severity === "OUT_OF_STOCK" || alert.availableCount <= 0;
  const badgeClass = isOutOfStock ? "badge-rose" : "badge-amber";
  const statusTitle = isOutOfStock ? "OUT OF STOCK ALERT" : "LOW STOCK WARNING";
  const statusColor = isOutOfStock ? "#b91c1c" : "#b45309";

  const subject = isOutOfStock
    ? `[ParkPing Alert] 🚨 OUT OF STOCK: ${alert.sku} (${alert.name})`
    : `[ParkPing Alert] ⚠️ Low Stock Alert: ${alert.sku} (${alert.availableCount} remaining)`;

  const timestampStr = alert.timestamp
    ? new Date(alert.timestamp).toLocaleString("en-IN")
    : new Date().toLocaleString("en-IN");

  const bodyContent = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <div>
        <h2 style="margin: 0; font-size: 20px; color: ${statusColor};">${statusTitle}</h2>
        <p style="margin: 4px 0 0 0; color: #64748b; font-size: 13px;">Detected at: ${timestampStr}</p>
      </div>
      <div>
        <span class="badge ${badgeClass}">${escapeHtml(alert.severity)}</span>
      </div>
    </div>

    <div class="info-card" style="border-left: 4px solid ${statusColor};">
      <h3 style="margin: 0; font-size: 16px; color: #0f172a;">${escapeHtml(alert.name)}</h3>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #64748b;">
        SKU: <strong>${escapeHtml(alert.sku)}</strong>
        ${alert.triggeredBy ? ` &bull; Triggered by: <em>${escapeHtml(alert.triggeredBy)}</em>` : ""}
      </p>
    </div>

    <table style="width: 100%; margin: 18px 0;">
      <tr>
        <td style="width: 50%; padding: 0 8px 0 0; vertical-align: top;">
          <div class="stat-cell" style="width: 100%;">
            <div class="stat-label">Available Sellable Stock</div>
            <div class="stat-value" style="color: ${statusColor}; font-size: 24px;">
              ${alert.availableCount}
            </div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
              OnHand: ${alert.quantityOnHand} | Reserved: ${alert.reservedCount ?? 0}
            </div>
          </div>
        </td>
        <td style="width: 50%; padding: 0 0 0 8px; vertical-align: top;">
          <div class="stat-cell" style="width: 100%;">
            <div class="stat-label">Configured Reorder Level</div>
            <div class="stat-value" style="font-size: 24px;">
              ${alert.reorderLevel}
            </div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
              Threshold for stock replenishment
            </div>
          </div>
        </td>
      </tr>
    </table>

    <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; margin-top: 16px;">
      <strong style="color: #92400e; font-size: 13px;">Action Required:</strong>
      <p style="margin: 6px 0 0 0; font-size: 13px; color: #78350f;">
        ${
          isOutOfStock
            ? "This component is completely exhausted. New customer orders containing this SKU will be blocked until inventory is replenished or re-inwarded."
            : "Available stock has dropped below your reorder threshold. Please prepare a replenishment order or check pending inward shipments to avoid stockouts."
        }
      </p>
    </div>
  `;

  const textLines = [
    `PARKPING INVENTORY ALERT: ${statusTitle}`,
    `========================================`,
    `SKU: ${alert.sku}`,
    `Item: ${alert.name}`,
    `Available Stock: ${alert.availableCount}`,
    `Physical On Hand: ${alert.quantityOnHand}`,
    `Reserved in Checkout: ${alert.reservedCount ?? 0}`,
    `Reorder Threshold: ${alert.reorderLevel}`,
    `Timestamp: ${timestampStr}`,
    alert.triggeredBy ? `Triggered By: ${alert.triggeredBy}` : "",
    ``,
    `Action: Please replenish inventory to avoid stock depletion.`,
  ].filter(Boolean);

  return {
    subject,
    html: wrapHtmlEmail(subject, bodyContent),
    text: textLines.join("\n"),
  };
};

/**
 * Render batch stock alerts digest email when multiple SKUs need attention.
 */
export const renderBatchStockAlertsEmail = (
  alerts: StockAlertData[]
): { subject: string; html: string; text: string } => {
  const count = alerts.length;
  const outOfStockCount = alerts.filter((a) => a.severity === "OUT_OF_STOCK" || a.availableCount <= 0).length;
  const subject = `[ParkPing Alert] ⚠️ Low Stock Digest: ${count} SKU(s) require attention (${outOfStockCount} out of stock)`;

  const rows = alerts
    .map((a) => {
      const isZero = a.availableCount <= 0;
      const badge = isZero
        ? `<span class="badge badge-rose">OUT OF STOCK</span>`
        : `<span class="badge badge-amber">LOW (${a.availableCount})</span>`;
      return `
      <tr>
        <td><strong>${escapeHtml(a.name)}</strong><br/><small style="color: #64748b;">${escapeHtml(a.sku)}</small></td>
        <td style="text-align: center;">${a.quantityOnHand}</td>
        <td style="text-align: center; font-weight: 700;">${a.availableCount}</td>
        <td style="text-align: center; color: #64748b;">${a.reorderLevel}</td>
        <td style="text-align: right;">${badge}</td>
      </tr>`;
    })
    .join("");

  const bodyContent = `
    <h2 style="margin: 0 0 8px 0; font-size: 20px; color: #0f172a;">Inventory Stock Alert Digest</h2>
    <p style="margin: 0 0 20px 0; color: #64748b; font-size: 13px;">
      The following ${count} item(s) are currently at or below their configured reorder threshold:
    </p>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Item / SKU</th>
            <th style="text-align: center;">On Hand</th>
            <th style="text-align: center;">Available</th>
            <th style="text-align: center;">Reorder Lvl</th>
            <th style="text-align: right;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-top: 20px;">
      <p style="margin: 0; font-size: 13px; color: #475569;">
        💡 Please review your warehouse supplies and initiate inward purchase orders or tag print batches accordingly.
      </p>
    </div>
  `;

  const textLines = [
    `PARKPING INVENTORY ALERT: STOCK DIGEST (${count} SKUs)`,
    `======================================================`,
    ...alerts.map(
      (a) =>
        `- ${a.sku} (${a.name}): Available=${a.availableCount}, ReorderLevel=${a.reorderLevel} [${a.severity}]`
    ),
  ];

  return {
    subject,
    html: wrapHtmlEmail(subject, bodyContent),
    text: textLines.join("\n"),
  };
};

/**
 * Render custom admin alert email.
 */
export const renderCustomAdminAlertEmail = (
  data: AdminCustomNotificationData
): { subject: string; html: string; text: string } => {
  const fullSubject = `[ParkPing] ${data.subject}`;
  const severity = data.severity || "INFO";
  const badgeClass =
    severity === "CRITICAL"
      ? "badge-rose"
      : severity === "WARNING"
      ? "badge-amber"
      : "badge-blue";

  let detailsHtml = "";
  if (data.details && Object.keys(data.details).length > 0) {
    const detailRows = Object.entries(data.details)
      .map(
        ([k, v]) => `
      <tr>
        <td style="font-weight: 600; color: #475569; width: 35%;">${escapeHtml(k)}</td>
        <td><code>${escapeHtml(typeof v === "object" ? JSON.stringify(v) : v)}</code></td>
      </tr>`
      )
      .join("");

    detailsHtml = `
      <div class="table-container" style="margin-top: 18px;">
        <table>
          <tbody>
            ${detailRows}
          </tbody>
        </table>
      </div>
    `;
  }

  const bodyContent = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 20px; color: #0f172a;">${escapeHtml(data.title)}</h2>
      <span class="badge ${badgeClass}">${escapeHtml(severity)}</span>
    </div>

    <div class="info-card">
      <p style="margin: 0; font-size: 14px; white-space: pre-wrap;">${escapeHtml(data.message)}</p>
    </div>

    ${detailsHtml}
  `;

  const textLines = [
    `PARKPING ADMIN ALERT: ${data.title} [${severity}]`,
    `==================================================`,
    data.message,
    "",
    data.details ? `Details: ${JSON.stringify(data.details, null, 2)}` : "",
  ].filter(Boolean);

  return {
    subject: fullSubject,
    html: wrapHtmlEmail(fullSubject, bodyContent),
    text: textLines.join("\n"),
  };
};

