import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Archivist",
  description: "Phone-to-archive document digitization with an AI filing agent",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
