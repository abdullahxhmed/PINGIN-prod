import React from "react";
import { Section, Text } from "@react-email/components";
import { emailTheme as theme } from "../theme.js";

interface EmailHeaderProps {
  badge?: string | undefined;
  useSvgLogo?: boolean | undefined;
}

export function EmailHeader({ badge, useSvgLogo = true }: EmailHeaderProps) {
  return (
    <Section
      style={{
        padding: "24px 28px 16px",
        borderBottom: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.surface,
        fontFamily: theme.fonts.sans,
      }}
    >
      <table width="100%" border={0} cellPadding={0} cellSpacing={0} style={{ fontFamily: theme.fonts.sans }}>
        <tbody>
          <tr>
            <td align="left" style={{ verticalAlign: "middle", fontFamily: theme.fonts.sans }}>
              {useSvgLogo ? (
                <img
                  src="https://storage.googleapis.com/kauntact_product_images/logos/kauntact.svg"
                  alt="Kauntact"
                  height="24"
                  style={{
                    display: "block",
                    height: "24px",
                    width: "auto",
                    border: "none",
                  }}
                />
              ) : (
                <Text
                  style={{
                    margin: 0,
                    fontSize: "24px",
                    fontWeight: 700,
                    letterSpacing: "-0.8px",
                    color: theme.colors.ink,
                    fontFamily: theme.fonts.display,
                  }}
                >
                  kaun
                  <span style={{ color: theme.colors.logoTact, fontFamily: theme.fonts.display }}>tact</span>
                </Text>
              )}
            </td>
            {badge && (
              <td align="right" style={{ verticalAlign: "middle", fontFamily: theme.fonts.sans }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    backgroundColor: theme.colors.ink,
                    color: "#ffffff",
                    fontSize: "11px",
                    fontWeight: 600,
                    fontFamily: theme.fonts.medium,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    borderRadius: theme.radius.sm,
                  }}
                >
                  {badge}
                </span>
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

export default EmailHeader;
