import React from "react";
import { Button } from "@react-email/components";
import { emailTheme as theme } from "../theme.js";

interface EmailButtonProps {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | undefined;
  style?: React.CSSProperties | undefined;
}

export function EmailButton({
  href,
  children,
  variant = "primary",
  style,
}: EmailButtonProps) {
  const isPrimary = variant === "primary";

  return (
    <Button
      href={href}
      style={{
        display: "inline-block",
        minHeight: "44px",
        lineHeight: "44px",
        padding: "0 22px",
        backgroundColor: isPrimary ? theme.colors.surfaceDark : "#ffffff",
        color: isPrimary ? theme.colors.surface : theme.colors.ink,
        border: isPrimary ? "none" : `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.sm,
        fontSize: "13px",
        fontWeight: 600,
        fontFamily: theme.fonts.medium,
        textDecoration: "none",
        textAlign: "center",
        boxShadow: isPrimary ? "0 2px 4px rgba(0,0,0,0.08)" : "none",
        ...style,
      }}
    >
      {children}
    </Button>
  );
}
