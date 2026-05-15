import "./globals.css";

export const metadata = {
  title: "Smart Planning IA JCDecaux",
  description: "MVP Smart Planning Retail Media DOOH"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
