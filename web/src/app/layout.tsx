import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

// Fonte da identidade Specifica: Light/Thin para elegância, Medium/SemiBold para destaque.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Specifica",
  description: "Visualizador 3D e downloads técnicos de produtos para arquitetos",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${poppins.variable} antialiased`}>{children}</body>
    </html>
  );
}
