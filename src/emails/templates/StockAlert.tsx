import React from "react";
import { Heading, Img, Section, Text } from "@react-email/components";
import { EmailLayout } from "../components/EmailLayout.js";
import { EmailButton } from "../components/EmailButton.js";
import { emailTheme as theme } from "../theme.js";

export interface StockAlertProps {
  sku: string;
  name: string;
  imageUrl?: string | undefined;
  quantityOnHand: number;
  reservedCount?: number | undefined;
  availableCount: number;
  reorderLevel: number;
  severity: "LOW_STOCK" | "OUT_OF_STOCK" | "CRITICAL" | string;
  triggeredBy?: string | undefined;
  timestamp?: Date | string | undefined;
  adminConsoleBaseUrl?: string | undefined;
}

export function StockAlert({
  sku,
  name,
  imageUrl,
  quantityOnHand,
  reservedCount = 0,
  availableCount,
  reorderLevel,
  severity,
  triggeredBy,
  timestamp = new Date(),
  adminConsoleBaseUrl = "https://kauntact.com",
}: StockAlertProps) {
  const isOut = severity === "OUT_OF_STOCK" || availableCount <= 0;
  const statusColor = isOut ? theme.colors.danger : "#b06000";
  const statusBg = isOut ? "#fce8e6" : "#fef7e0";
  const statusBorder = isOut ? "#fad2cf" : "#feefc3";
  const title = isOut ? `OUT OF STOCK: ${sku}` : `Low Stock Alert: ${sku}`;
  const dateStr = new Date(timestamp).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const inventoryUrl = `${adminConsoleBaseUrl}/admin/inventory`;

  return (
    <EmailLayout
      preview={`[Kauntact Alert] ${title} (${availableCount} left)`}
      badge={isOut ? "OUT OF STOCK" : "LOW STOCK"}
      referenceId={sku}
      footerNote="Threshold monitor runs automatically across all active stock-keeping units."
    >
      <Text
        style={{
          margin: 0,
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "1.2px",
          color: statusColor,
          fontFamily: theme.fonts.medium,
          textTransform: "uppercase",
        }}
      >
        Inventory Threshold Warning
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
        {title}
      </Heading>

      <Text
        style={{
          margin: "4px 0 20px 0",
          fontSize: "13px",
          color: theme.colors.muted,
          fontFamily: theme.fonts.sans,
        }}
      >
        Recorded on {dateStr}
      </Text>

      {/* Item Details Card */}
      <Section
        style={{
          padding: "16px",
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.sm,
          border: `1px solid ${theme.colors.border}`,
          marginBottom: "16px",
          fontFamily: theme.fonts.sans,
        }}
      >
        <table width="100%" border={0} cellPadding={0} cellSpacing={0} style={{ fontFamily: theme.fonts.sans }}>
          <tbody>
            <tr>
              <td align="left" style={{ verticalAlign: "top", paddingBottom: "12px", fontFamily: theme.fonts.sans }}>
                <table border={0} cellPadding={0} cellSpacing={0} style={{ fontFamily: theme.fonts.sans }}>
                  <tbody>
                    <tr>
                      {imageUrl && (
                        <td style={{ verticalAlign: "top", paddingRight: "12px", fontFamily: theme.fonts.sans }}>
                          <Img
                            src={imageUrl}
                            alt={name}
                            width="48"
                            height="48"
                            style={{
                              display: "block",
                              width: "48px",
                              height: "48px",
                              borderRadius: theme.radius.sm,
                              border: `1px solid ${theme.colors.border}`,
                              objectFit: "cover",
                              backgroundColor: "#ffffff",
                            }}
                          />
                        </td>
                      )}
                      <td style={{ verticalAlign: "top", fontFamily: theme.fonts.sans }}>
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 600,
                            color: theme.colors.muted,
                            textTransform: "uppercase",
                            fontFamily: theme.fonts.medium,
                          }}
                        >
                          Item Name &amp; SKU
                        </span>
                        <div
                          style={{
                            fontSize: "15px",
                            fontWeight: 700,
                            color: theme.colors.ink,
                            marginTop: "2px",
                            fontFamily: theme.fonts.sans,
                          }}
                        >
                          {name}
                        </div>
                        <div
                          style={{
                            fontSize: "12px",
                            fontFamily: theme.fonts.medium,
                            color: theme.colors.muted,
                            marginTop: "2px",
                          }}
                        >
                          SKU: {sku}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td align="right" style={{ verticalAlign: "top", paddingBottom: "12px", fontFamily: theme.fonts.sans }}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: theme.colors.muted,
                    textTransform: "uppercase",
                    fontFamily: theme.fonts.medium,
                  }}
                >
                  Available Sellable
                </span>
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: 800,
                    color: statusColor,
                    fontFamily: theme.fonts.medium,
                    marginTop: "2px",
                  }}
                >
                  {availableCount}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Breakdown */}
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
              <td style={{ color: theme.colors.muted, padding: "3px 0", width: "45%", fontFamily: theme.fonts.sans }}>
                Physical On Hand:
              </td>
              <td style={{ fontFamily: theme.fonts.medium, fontWeight: 600, color: theme.colors.ink }}>
                {quantityOnHand}
              </td>
            </tr>
            <tr>
              <td style={{ color: theme.colors.muted, padding: "3px 0", fontFamily: theme.fonts.sans }}>
                Reserved in Checkouts:
              </td>
              <td style={{ fontFamily: theme.fonts.medium, color: theme.colors.muted }}>
                {reservedCount}
              </td>
            </tr>
            <tr>
              <td style={{ color: theme.colors.muted, padding: "3px 0", fontFamily: theme.fonts.sans }}>
                Reorder Threshold:
              </td>
              <td style={{ fontFamily: theme.fonts.medium, fontWeight: 600, color: theme.colors.ink }}>
                {reorderLevel}
              </td>
            </tr>
            {triggeredBy && (
              <tr>
                <td style={{ color: theme.colors.muted, padding: "3px 0", fontFamily: theme.fonts.sans }}>Triggered By:</td>
                <td style={{ color: theme.colors.muted, fontFamily: theme.fonts.sans }}>{triggeredBy}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      {/* Suggested Action Box */}
      <Section
        style={{
          padding: "14px 16px",
          backgroundColor: statusBg,
          borderRadius: theme.radius.sm,
          border: `1px solid ${statusBorder}`,
          marginBottom: "20px",
          fontFamily: theme.fonts.sans,
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: statusColor,
            textTransform: "uppercase",
            fontFamily: theme.fonts.medium,
          }}
        >
          {isOut ? "Critical Depletion" : "Reorder Recommended"}
        </div>
        <div style={{ fontSize: "12px", color: theme.colors.ink, marginTop: "4px", lineHeight: "1.4", fontFamily: theme.fonts.sans }}>
          {isOut
            ? "Available inventory has reached zero. New checkout orders containing this component will be held or blocked."
            : `Stock has fallen to or below the reorder point (${reorderLevel}). Initiate vendor purchase orders or tag print jobs to replenish.`}
        </div>
      </Section>

      <Section style={{ textAlign: "center", marginTop: "20px", fontFamily: theme.fonts.sans }}>
        <EmailButton href={inventoryUrl}>Manage Inventory in Admin Console &rarr;</EmailButton>
      </Section>
    </EmailLayout>
  );
}

export default StockAlert;
