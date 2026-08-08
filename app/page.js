'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const D = { client: 'South Beach Auto Accident Attorney', keyword: 'car accident lawyer miami beach',
  gbp_name: 'South Beach Auto Accident Attorney', center_lat: '25.7826', center_lng: '-80.1341',
  grid_size: '7', spacing_miles: '1' };

export default function Home() {
  const r = useRouter();
  const [f, setF] = useState(D);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [scans, setScans] = useState([]);

  useEffect(() => { setKey(localStorage.getItem('gg_admin') || ''); }, []);
  useEffect(() => {
    if (!key) return;
    localStorage.setItem('gg_admin', key);
    fetch('/api/scan', { headers: { 'x-admin-key': key } }).then(x => x.json())
      .then(j => setScans(j.scans || [])).catch(() => {});
  }, [key]);

  const launch = async () => {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
        body: JSON.stringify(f)
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.status);
      r.push(`/scan/${j.scan_id}`);
    } catch (e) { setErr(String(e.message || e)); setBusy(false); }
  };

  const inp = { width: '100%', padding: '10px 12px', background: '#111a2e', color: '#e5e7eb',
    border: '1px solid #263450', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' };
  const lbl = { fontSize: 12, color: '#8aa0c5', margin: '12px 0 4px', display: 'block' };

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 26, margin: 0 }}>Geo-Grid Rank Tracker</h1>
      <p style={{ color: '#8aa0c5', marginTop: 6 }}>Real-device Maps scans on a live GPS grid.</p>
      <label style={lbl}>Admin key</label>
      <input style={inp} type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="ADMIN_KEY" />
      {[['client','Client'],['keyword','Keyword'],['gbp_name','GBP name (exact listing title)'],
        ['center_lat','Center latitude'],['center_lng','Center longitude'],
        ['grid_size','Grid size (odd: 5/7/9)'],['spacing_miles','Spacing (miles)']].map(([k, label]) => (
        <div key={k}>
          <label style={lbl}>{label}</label>
          <input style={inp} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} />
        </div>
      ))}
      <button onClick={launch} disabled={busy || !key}
        style={{ marginTop: 18, width: '100%', padding: '12px 0', background: busy ? '#334155' : '#2563eb',
          color: '#fff', border: 0, borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
        {busy ? 'Dispatching…' : `Launch scan (${f.grid_size}×${f.grid_size})`}
      </button>
      {err && <p style={{ color: '#f87171', fontSize: 13 }}>{err}</p>}
      {scans.length > 0 && <>
        <h3 style={{ marginTop: 32, fontSize: 15, color: '#8aa0c5' }}>Recent scans</h3>
        {scans.map(s => (
          <a key={s.id} href={`/scan/${s.id}`} style={{ display: 'block', padding: '10px 12px', margin: '6px 0',
            background: '#111a2e', border: '1px solid #263450', borderRadius: 8, color: '#e5e7eb',
            textDecoration: 'none', fontSize: 13 }}>
            <b>{s.keyword}</b> — {s.status} ({s.points_done}/{s.points_total})
            <span style={{ color: '#64748b' }}> · {new Date(s.created_at).toLocaleString()}</span>
          </a>
        ))}
      </>}
    </main>
  );
}
