import React, { type ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
} from "@react-email/components";
import { emailTheme as theme } from "../theme.js";
import { EmailHeader } from "./EmailHeader.js";
import { EmailFooter } from "./EmailFooter.js";

export interface EmailLayoutProps {
  preview: string;
  badge?: string | undefined;
  referenceId?: string | undefined;
  footerNote?: string | undefined;
  children: ReactNode;
}

export function EmailLayout({
  preview,
  badge = "Admin Alert",
  referenceId,
  footerNote,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head>
        {/* Fontshare Satoshi Webfont stylesheet for supported clients */}
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@500,700&display=swap"
        />
        <style>
          {`
            @import url('https://api.fontshare.com/v2/css?f[]=satoshi@500,700&display=swap');
            
            * {
              font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
            }
          `}
        </style>
      </Head>
      <Preview>{preview}</Preview>

      <Body
        style={{
          margin: 0,
          padding: "24px 12px",
          backgroundColor: theme.colors.canvas,
          color: theme.colors.ink,
          fontFamily: theme.fonts.sans,
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            backgroundColor: "#ffffff",
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radius.md,
            overflow: "hidden",
            boxShadow: "0 4px 12px rgba(17, 17, 15, 0.04)",
            fontFamily: theme.fonts.sans,
          }}
        >
          {/* Reusable Kauntact Header */}
          <EmailHeader badge={badge} />

          {/* Main Content Body */}
          <Section style={{ padding: "28px", fontFamily: theme.fonts.sans }}>
            {children}
          </Section>

          {/* Reusable Footer */}
          <EmailFooter referenceId={referenceId} note={footerNote} />
        </Container>
      </Body>
    </Html>
  );
}

export default EmailLayout;
