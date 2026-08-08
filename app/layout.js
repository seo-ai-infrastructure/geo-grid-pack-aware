export const metadata = { title: 'Geo-Grid Rank Tracker', description: 'Real-device Maps geo-grid rank scanning' };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0b1220', color: '#e5e7eb' }}>
        {children}
      </body>
    </html>
  );
}
