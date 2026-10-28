import React from "react";
import { Heading, Img, Section, Text } from "@react-email/components";
import { EmailLayout } from "../components/EmailLayout.js";
import { EmailButton } from "../components/EmailButton.js";
import { emailTheme as theme } from "../theme.js";

export interface EmailOrderItem {
  id: string;
  name: string;
  variantName?: string | undefined;
  sku: string;
  imageUrl?: string | undefined;
  quantity: number;
  unitPricePaise: number;
  totalPricePaise: number;
  components?:
    | Array<{
        name: string;
        quantity: number;
        type: string;
      }>
    | undefined;
}

export interface OrderConfirmationProps {
  orderNumber: string;
  orderId: string;
  orderCreatedAt?: string | undefined;
  customer: {
    name: string;
    email: string;
    phone: string;
    address: {
      addressLine1: string;
      addressLine2?: string | undefined;
      city: string;
      state: string;
      postalCode: string;
      country?: string | undefined;
    };
  };
  payment: {
    status: "CAPTURED" | "AUTHORIZED" | "PENDING" | "FAILED" | string;
    provider: "RAZORPAY" | string;
    razorpayOrderId?: string | undefined;
    razorpayPaymentId?: string | undefined;
    razorpaySignatureVerified?: boolean | undefined;
    method?: string | undefined;
    vpa?: string | undefined;
    bank?: string | undefined;
    cardLast4?: string | undefined;
    feePaise?: number | undefined;
    taxPaise?: number | undefined;
  };
  items: EmailOrderItem[];
  subtotalPaise: number;
  shippingFeePaise: number;
  discountPaise?: number | undefined;
  totalAmountPaise: number;
  adminConsoleBaseUrl?: string | undefined;
  razorpayDashboardBaseUrl?: string | undefined;
}

export function OrderConfirmation({
  orderNumber,
  orderId,
  orderCreatedAt = new Date().toISOString(),
  customer,
  payment,
  items = [],
  subtotalPaise,
  shippingFeePaise = 0,
  discountPaise = 0,
  totalAmountPaise,
  adminConsoleBaseUrl = "https://kauntact.com",
  razorpayDashboardBaseUrl = "https://dashboard.razorpay.com",
}: OrderConfirmationProps) {
  const formatPrice = (paise: number) =>
    `₹${(paise / 100).toLocaleString("en-IN", {
      maximumFractionDigits: 2,
    })}`;

  const fulfillmentUrl = `${adminConsoleBaseUrl}/admin/orders?order=${encodeURIComponent(
    orderNumber
  )}`;
  const razorpayUrl = payment.razorpayPaymentId
    ? `${razorpayDashboardBaseUrl}/app/payments/${payment.razorpayPaymentId}`
    : `${razorpayDashboardBaseUrl}/app/orders/${payment.razorpayOrderId || ""}`;

  return (
    <EmailLayout
      preview={`New Order #${orderNumber} (${formatPrice(totalAmountPaise)})`}
      badge={`Order ${payment.status === "CAPTURED" ? "Paid" : "Created"}`}
      referenceId={orderId}
      footerNote="Fulfillment outbox job queued. Tags will be allocated during the warehouse packing session."
    >
      {/* 1. Order Header */}
      <Text
        style={{
          margin: 0,
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "1.2px",
          color: theme.colors.muted,
          fontFamily: theme.fonts.medium,
          textTransform: "uppercase",
        }}
      >
        New Order Confirmed
      </Text>

      <Heading
        as="h1"
        style={{
          margin: "4px 0 0 0",
          fontSize: "24px",
          fontWeight: 700,
          letterSpacing: "-0.6px",
          color: theme.colors.ink,
          fontFamily: theme.fonts.sans,
        }}
      >
        Order #{orderNumber}
      </Heading>

      <Text
        style={{
          margin: "4px 0 20px 0",
          fontSize: "13px",
          color: theme.colors.muted,
          fontFamily: theme.fonts.sans,
        }}
      >
        Received on{" "}
        {new Date(orderCreatedAt).toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </Text>

      {/* 2. Razorpay Payment Status Box */}
      <Section
        style={{
          padding: "16px",
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.sm,
          border: `1px solid ${theme.colors.border}`,
          marginBottom: "20px",
          fontFamily: theme.fonts.sans,
        }}
      >
        <table width="100%" border={0} cellPadding={0} cellSpacing={0} style={{ fontFamily: theme.fonts.sans }}>
          <tbody>
            <tr>
              <td align="left" style={{ verticalAlign: "top", paddingBottom: "10px", fontFamily: theme.fonts.sans }}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: theme.colors.muted,
                    textTransform: "uppercase",
                    fontFamily: theme.fonts.medium,
                  }}
                >
                  Payment Status
                </span>
                <div style={{ marginTop: "4px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      backgroundColor:
                        payment.status === "CAPTURED" ? "#e6f4ea" : "#fef7e0",
                      color:
                        payment.status === "CAPTURED"
                          ? theme.colors.success
                          : "#b06000",
                      fontSize: "11px",
                      fontWeight: 700,
                      fontFamily: theme.fonts.medium,
                      borderRadius: "12px",
                      border: `1px solid ${
                        payment.status === "CAPTURED" ? "#ceead6" : "#feefc3"
                      }`,
                    }}
                  >
                    ● {payment.status}
                  </span>
                  {payment.razorpaySignatureVerified && (
                    <span
                      style={{
                        marginLeft: "8px",
                        fontSize: "11px",
                        color: theme.colors.success,
                        fontWeight: 600,
                        fontFamily: theme.fonts.medium,
                      }}
                    >
                      ✓ Signature Verified
                    </span>
                  )}
                </div>
              </td>
              <td align="right" style={{ verticalAlign: "top", paddingBottom: "10px", fontFamily: theme.fonts.sans }}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: theme.colors.muted,
                    textTransform: "uppercase",
                    fontFamily: theme.fonts.medium,
                  }}
                >
                  Total Collected
                </span>
                <div
                  style={{
                    fontSize: "18px",
                    fontWeight: 700,
                    color: theme.colors.ink,
                    fontFamily: theme.fonts.medium,
                    marginTop: "2px",
                  }}
                >
                  {formatPrice(totalAmountPaise)}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Payment Metadata Rows */}
        <table
          width="100%"
          border={0}
          cellPadding={0}
          cellSpacing={0}
          style={{
            borderTop: `1px dashed ${theme.colors.border}`,
            paddingTop: "10px",
            fontSize: "12px",
            fontFamily: theme.fonts.sans,
          }}
        >
          <tbody>
            <tr>
              <td style={{ color: theme.colors.muted, padding: "2px 0", width: "40%", fontFamily: theme.fonts.sans }}>
                Payment ID:
              </td>
              <td style={{ fontFamily: theme.fonts.medium, fontWeight: 600, color: theme.colors.ink }}>
                {payment.razorpayPaymentId || "—"}
              </td>
            </tr>
            <tr>
              <td style={{ color: theme.colors.muted, padding: "2px 0", fontFamily: theme.fonts.sans }}>
                Razorpay Order ID:
              </td>
              <td style={{ fontFamily: theme.fonts.medium, color: theme.colors.muted }}>
                {payment.razorpayOrderId || "—"}
              </td>
            </tr>
            {payment.method && (
              <tr>
                <td style={{ color: theme.colors.muted, padding: "2px 0", fontFamily: theme.fonts.sans }}>Method:</td>
                <td style={{ fontFamily: theme.fonts.sans, color: theme.colors.ink }}>
                  {payment.method}{" "}
                  {payment.vpa
                    ? `(${payment.vpa})`
                    : payment.cardLast4
                    ? `(Card ending ${payment.cardLast4})`
                    : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      {/* 3. Customer & Shipping Destination */}
      <Section
        style={{
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.sm,
          backgroundColor: "#ffffff",
          marginBottom: "20px",
          fontFamily: theme.fonts.sans,
        }}
      >
        <table width="100%" border={0} cellPadding={0} cellSpacing={0} style={{ fontFamily: theme.fonts.sans }}>
          <tbody>
            <tr>
              <td
                style={{
                  width: "50%",
                  padding: "16px",
                  verticalAlign: "top",
                  borderRight: `1px solid ${theme.colors.border}`,
                  fontFamily: theme.fonts.sans,
                }}
              >
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: theme.colors.muted,
                    textTransform: "uppercase",
                    fontFamily: theme.fonts.medium,
                  }}
                >
                  Customer Details
                </span>
                <div style={{ fontSize: "13px", fontWeight: 600, marginTop: "4px", fontFamily: theme.fonts.sans, color: theme.colors.ink }}>
                  {customer.name}
                </div>
                <div style={{ fontSize: "12px", color: theme.colors.muted, marginTop: "2px", fontFamily: theme.fonts.sans }}>
                  {customer.email}
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    fontFamily: theme.fonts.medium,
                    marginTop: "2px",
                    color: theme.colors.ink,
                  }}
                >
                  {customer.phone}
                </div>
              </td>
              <td style={{ width: "50%", padding: "16px", verticalAlign: "top", fontFamily: theme.fonts.sans }}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: theme.colors.muted,
                    textTransform: "uppercase",
                    fontFamily: theme.fonts.medium,
                  }}
                >
                  Delivery Address
                </span>
                <div style={{ fontSize: "12px", marginTop: "4px", lineHeight: "1.4", fontFamily: theme.fonts.sans, color: theme.colors.ink }}>
                  {customer.address.addressLine1}
                  {customer.address.addressLine2
                    ? `, ${customer.address.addressLine2}`
                    : ""}
                  <br />
                  {customer.address.city}, {customer.address.state} &mdash;{" "}
                  <strong style={{ fontFamily: theme.fonts.medium }}>
                    {customer.address.postalCode}
                  </strong>
                  <br />
                  <span style={{ color: theme.colors.muted, fontFamily: theme.fonts.sans }}>
                    {customer.address.country || "India"}
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      {/* 4. Line Items Table with Thumbnails */}
      <div
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color: theme.colors.muted,
          textTransform: "uppercase",
          fontFamily: theme.fonts.medium,
          marginBottom: "8px",
        }}
      >
        Order Line Items ({items.length})
      </div>

      <table
        width="100%"
        border={0}
        cellPadding={0}
        cellSpacing={0}
        style={{
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.sm,
          borderCollapse: "separate",
          overflow: "hidden",
          fontFamily: theme.fonts.sans,
        }}
      >
        <thead>
          <tr
            style={{
              backgroundColor: theme.colors.surface,
              borderBottom: `1px solid ${theme.colors.border}`,
            }}
          >
            <th
              align="left"
              style={{
                padding: "10px 14px",
                fontSize: "11px",
                color: theme.colors.muted,
                fontFamily: theme.fonts.medium,
              }}
            >
              Item
            </th>
            <th
              align="center"
              style={{
                padding: "10px 14px",
                fontSize: "11px",
                color: theme.colors.muted,
                fontFamily: theme.fonts.medium,
              }}
            >
              Qty
            </th>
            <th
              align="right"
              style={{
                padding: "10px 14px",
                fontSize: "11px",
                color: theme.colors.muted,
                fontFamily: theme.fonts.medium,
              }}
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr
              key={item.id}
              style={{
                borderTop: index > 0 ? `1px solid ${theme.colors.border}` : "none",
                backgroundColor: "#ffffff",
              }}
            >
              <td style={{ padding: "14px", verticalAlign: "top", fontFamily: theme.fonts.sans }}>
                <table border={0} cellPadding={0} cellSpacing={0} style={{ fontFamily: theme.fonts.sans }}>
                  <tbody>
                    <tr>
                      {item.imageUrl && (
                        <td style={{ verticalAlign: "top", paddingRight: "12px", fontFamily: theme.fonts.sans }}>
                          <Img
                            src={item.imageUrl}
                            alt={item.name}
                            width="48"
                            height="48"
                            style={{
                              display: "block",
                              width: "48px",
                              height: "48px",
                              borderRadius: theme.radius.sm,
                              border: `1px solid ${theme.colors.border}`,
                              objectFit: "cover",
                              backgroundColor: theme.colors.surface,
                            }}
                          />
                        </td>
                      )}
                      <td style={{ verticalAlign: "top", fontFamily: theme.fonts.sans }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: theme.colors.ink, fontFamily: theme.fonts.sans }}>
                          {item.name}
                        </div>
                        <div style={{ marginTop: "2px", fontFamily: theme.fonts.sans }}>
                          {item.variantName && (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "1px 6px",
                                backgroundColor: theme.colors.surface,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: theme.radius.sm,
                                fontSize: "10px",
                                color: theme.colors.ink,
                                marginRight: "6px",
                                fontFamily: theme.fonts.sans,
                              }}
                            >
                              {item.variantName}
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: "11px",
                              fontFamily: theme.fonts.medium,
                              color: theme.colors.muted,
                            }}
                          >
                            {item.sku}
                          </span>
                        </div>

                        {/* Components */}
                        {item.components && item.components.length > 0 && (
                          <div style={{ marginTop: "6px", fontFamily: theme.fonts.sans }}>
                            {item.components.map((c, i) => (
                              <span
                                key={i}
                                style={{
                                  display: "inline-block",
                                  fontSize: "10px",
                                  color: theme.colors.muted,
                                  backgroundColor: theme.colors.surface,
                                  padding: "2px 6px",
                                  borderRadius: theme.radius.sm,
                                  marginRight: "4px",
                                  marginBottom: "3px",
                                  fontFamily: theme.fonts.sans,
                                }}
                              >
                                {c.type === "SERIALIZED_QR_TAG" ? "🏷️" : "📦"}{" "}
                                {c.quantity}&times; {c.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td
                align="center"
                style={{
                  padding: "14px",
                  verticalAlign: "top",
                  fontSize: "13px",
                  fontFamily: theme.fonts.medium,
                  fontWeight: 600,
                }}
              >
                {item.quantity}
              </td>
              <td
                align="right"
                style={{
                  padding: "14px",
                  verticalAlign: "top",
                  fontSize: "13px",
                  fontFamily: theme.fonts.medium,
                  fontWeight: 600,
                }}
              >
                {formatPrice(item.totalPricePaise)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals Table */}
      <table
        width="100%"
        border={0}
        cellPadding={0}
        cellSpacing={0}
        style={{ marginTop: "12px", fontSize: "12px", fontFamily: theme.fonts.sans }}
      >
        <tbody>
          <tr>
            <td align="right" style={{ color: theme.colors.muted, padding: "3px 0", fontFamily: theme.fonts.sans }}>
              Subtotal:
            </td>
            <td
              align="right"
              style={{ width: "100px", fontFamily: theme.fonts.medium, padding: "3px 0", color: theme.colors.ink }}
            >
              {formatPrice(subtotalPaise)}
            </td>
          </tr>
          <tr>
            <td align="right" style={{ color: theme.colors.muted, padding: "3px 0", fontFamily: theme.fonts.sans }}>
              Shipping:
            </td>
            <td
              align="right"
              style={{ width: "100px", fontFamily: theme.fonts.medium, padding: "3px 0", color: theme.colors.ink }}
            >
              {shippingFeePaise === 0 ? "FREE" : formatPrice(shippingFeePaise)}
            </td>
          </tr>
          {discountPaise !== undefined && discountPaise > 0 && (
            <tr>
              <td align="right" style={{ color: theme.colors.success, padding: "3px 0", fontFamily: theme.fonts.sans }}>
                Discount:
              </td>
              <td
                align="right"
                style={{
                  width: "100px",
                  fontFamily: theme.fonts.medium,
                  color: theme.colors.success,
                  padding: "3px 0",
                }}
              >
                -{formatPrice(discountPaise)}
              </td>
            </tr>
          )}
          <tr>
            <td
              align="right"
              style={{
                fontWeight: 700,
                padding: "8px 0 0 0",
                borderTop: `1px solid ${theme.colors.border}`,
                fontFamily: theme.fonts.sans,
                color: theme.colors.ink,
              }}
            >
              Total Collected:
            </td>
            <td
              align="right"
              style={{
                fontWeight: 700,
                fontFamily: theme.fonts.medium,
                fontSize: "15px",
                padding: "8px 0 0 0",
                borderTop: `1px solid ${theme.colors.border}`,
                color: theme.colors.ink,
              }}
            >
              {formatPrice(totalAmountPaise)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* 5. Action Buttons */}
      <Section style={{ textAlign: "center", marginTop: "24px", fontFamily: theme.fonts.sans }}>
        <EmailButton href={fulfillmentUrl} style={{ marginRight: "10px" }}>
          Assign Tags &amp; Fulfill Order &rarr;
        </EmailButton>
        <EmailButton href={razorpayUrl} variant="secondary">
          Razorpay Dashboard &#8599;
        </EmailButton>
      </Section>
    </EmailLayout>
  );
}

export default OrderConfirmation;
