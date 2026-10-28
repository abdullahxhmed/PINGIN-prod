import React from "react";
import { Section, Text } from "@react-email/components";
import { emailTheme as theme } from "../theme.js";

interface EmailFooterProps {
  referenceId?: string | undefined;
  note?: string | undefined;
}

export function EmailFooter({ referenceId, note }: EmailFooterProps) {
  return (
    <Section
      style={{
        padding: "20px 28px",
        backgroundColor: "#ffffff",
        borderTop: `1px solid ${theme.colors.border}`,
        textAlign: "center",
        fontFamily: theme.fonts.sans,
      }}
    >
      {note && (
        <Text
          style={{
            margin: "0 0 6px 0",
            fontSize: "12px",
            lineHeight: "1.6",
            color: theme.colors.muted,
            fontFamily: theme.fonts.sans,
          }}
        >
          {note}
        </Text>
      )}
      <Text
        style={{
          margin: 0,
          fontSize: "11px",
          color: theme.colors.subtle,
          fontFamily: theme.fonts.sans,
        }}
      >
        Kauntact Operations &amp; Inventory Management
      </Text>
      {referenceId && (
        <Text
          style={{
            margin: "4px 0 0 0",
            fontSize: "10px",
            fontFamily: theme.fonts.medium,
            color: theme.colors.subtle,
          }}
        >
          System generated dispatch &bull; Ref: {referenceId}
        </Text>
      )}
    </Section>
  );
}

export default EmailFooter;
