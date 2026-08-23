import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "RagUi — Chat with your documents",
  description:
    "Retrieval-Augmented Generation chat: upload documents, search them with hybrid keyword + semantic retrieval, stream grounded answers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
