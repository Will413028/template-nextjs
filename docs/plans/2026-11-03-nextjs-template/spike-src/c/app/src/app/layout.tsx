// No dynamic reads here (wiki/tech/nextjs-cache-components.md): root layout stays prerenderable.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
