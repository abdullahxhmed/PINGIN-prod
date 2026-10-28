import React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "../components/EmailLayout.js";
import { EmailButton } from "../components/EmailButton.js";
import { emailTheme as theme } from "../theme.js";

export interface ShippingUpdateProps {
  orderNumber: string;
  orderId: string;
  courierName?: string | undefined;
  awbCode: string;
  trackingUrl?: string | undefined;
  recipientName: string;
  destinationCity: string;
  shippedAt?: string | undefined;
}

export function ShippingUpdate({
  orderNumber,
  orderId,
  courierName = "Shiprocket",
  awbCode,
  trackingUrl,
  recipientName,
  destinationCity,
  shippedAt = new Date().toISOString(),
}: ShippingUpdateProps) {
  const publicTrackUrl =
    trackingUrl || `https://kauntact.in/orders/track/${encodeURIComponent(awbCode)}`;

  return (
    <EmailLayout
      preview={`Order #${orderNumber} Dispatched (${courierName} AWB: ${awbCode})`}
      badge="Order Shipped"
      referenceId={orderId}
      footerNote="Courier updates are synced in real-time via carrier webhooks."
    >
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
        Warehouse Dispatch Notification
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
        Order Shipped 🚚
      </Heading>

      <Text
        style={{
          margin: "4px 0 20px 0",
          fontSize: "13px",
          color: theme.colors.muted,
          fontFamily: theme.fonts.sans,
        }}
      >
        Dispatched on{" "}
        {new Date(shippedAt).toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </Text>

      <Section
        style={{
          padding: "18px",
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
              <td style={{ color: theme.colors.muted, padding: "4px 0", width: "40%", fontFamily: theme.fonts.sans }}>
                Order Number:
              </td>
              <td style={{ fontFamily: theme.fonts.medium, fontWeight: 700, color: theme.colors.ink }}>
                #{orderNumber}
              </td>
            </tr>
            <tr>
              <td style={{ color: theme.colors.muted, padding: "4px 0", fontFamily: theme.fonts.sans }}>Courier Partner:</td>
              <td style={{ fontWeight: 600, fontFamily: theme.fonts.sans, color: theme.colors.ink }}>{courierName}</td>
            </tr>
            <tr>
              <td style={{ color: theme.colors.muted, padding: "4px 0", fontFamily: theme.fonts.sans }}>AWB / Waybill:</td>
              <td
                style={{
                  fontFamily: theme.fonts.medium,
                  fontWeight: 700,
                  color: theme.colors.ink,
                }}
              >
                {awbCode}
              </td>
            </tr>
            <tr>
              <td style={{ color: theme.colors.muted, padding: "4px 0", fontFamily: theme.fonts.sans }}>Destination:</td>
              <td style={{ fontFamily: theme.fonts.sans, color: theme.colors.ink }}>
                {recipientName} &bull; {destinationCity}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section style={{ textAlign: "center", marginTop: "20px", fontFamily: theme.fonts.sans }}>
        <EmailButton href={publicTrackUrl}>Track Shipment Live &rarr;</EmailButton>
      </Section>
    </EmailLayout>
  );
}

export default ShippingUpdate;
