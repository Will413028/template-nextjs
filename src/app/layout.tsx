import "./globals.css";

// The <html> element is rendered per locale in [locale]/layout.tsx.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
