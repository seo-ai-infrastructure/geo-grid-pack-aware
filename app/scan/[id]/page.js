'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

const color = p => p == null ? '#475569' : p === 0 ? '#dc2626' : p <= 3 ? '#16a34a' : p <= 10 ? '#ca8a04' : '#ea580c';
const labelFor = p => p == null ? '…' : p === 0 ? '20+' : String(p);

export default function ScanView() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markers = useRef({});

  // poll
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await fetch(`/api/scan/${id}`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (alive) setData(j);
      if (alive && j.scan?.status === 'running') setTimeout(load, 8000);
    };
    load();
    return () => { alive = false; };
  }, [id]);

  // leaflet bootstrap
  useEffect(() => {
    if (!data || leafletMap.current) return;
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => {
      const L = window.L;
      const m = L.map(mapRef.current, { zoomControl: true, attributionControl: true })
        .setView([data.scan.center_lat, data.scan.center_lng], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(m);
      L.marker([data.scan.center_lat, data.scan.center_lng], {
        icon: L.divIcon({ className: '', html: '<div style="font-size:22px;line-height:22px">⭐</div>', iconSize: [22, 22], iconAnchor: [11, 11] })
      }).addTo(m).bindTooltip(data.scan.gbp_name);
      leafletMap.current = m;
      renderMarkers(L, m);
    };
    document.head.appendChild(s);
  }, [data]);

  const renderMarkers = (L, m) => {
    if (!data) return;
    for (const p of data.points) {
      const html = `<div style="width:34px;height:34px;border-radius:50%;background:${color(p.state === 'done' ? p.position : null)};
        display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;
        border:2px solid rgba(255,255,255,.85);box-shadow:0 1px 4px rgba(0,0,0,.5)">${labelFor(p.state === 'done' ? p.position : null)}</div>`;
      const icon = L.divIcon({ className: '', html, iconSize: [34, 34], iconAnchor: [17, 17] });
      const pk = p.pack_position == null ? '' : ` · pack ${p.pack_position === 0 ? 'out' : '#' + p.pack_position}`;
      const tip = `${p.label} — ${p.state}${pk}`;
      if (markers.current[p.label]) { markers.current[p.label].setIcon(icon); markers.current[p.label].setTooltipContent(tip); }
      else markers.current[p.label] = L.marker([p.lat, p.lng], { icon }).addTo(m).bindTooltip(tip);
    }
  };
  useEffect(() => { if (leafletMap.current && window.L) renderMarkers(window.L, leafletMap.current); }, [data]);

  const resume = async () => {
    await fetch('/api/tick', { method: 'POST', headers: { 'x-admin-key': localStorage.getItem('gg_admin') || '' } });
  };

  if (!data) return <main style={{ padding: 40 }}>Loading…</main>;
  const { scan, points } = data;
  const done = points.filter(p => p.state === 'done');
  const found = done.filter(p => p.position > 0);
  const avg = found.length ? (found.reduce((a, p) => a + p.position, 0) / found.length).toFixed(1) : '—';
  const top3 = done.length ? Math.round(100 * done.filter(p => p.position >= 1 && p.position <= 3).length / done.length) : 0;

  const chip = { background: '#111a2e', border: '1px solid #263450', borderRadius: 10, padding: '10px 16px' };
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px' }}>
      <a href="/" style={{ color: '#60a5fa', fontSize: 13, textDecoration: 'none' }}>← New scan</a>
      <h1 style={{ fontSize: 20, margin: '8px 0 2px' }}>{scan.keyword}</h1>
      <div style={{ color: '#8aa0c5', fontSize: 13 }}>{scan.gbp_name} · {scan.grid_size}×{scan.grid_size} @ {scan.spacing_miles} mi · {scan.status}</div>
      <div style={{ display: 'flex', gap: 12, margin: '16px 0', flexWrap: 'wrap', fontSize: 14 }}>
        <div style={chip}><b>{scan.points_done}/{scan.points_total}</b> points</div>
        <div style={chip}>avg rank <b>{avg}</b></div>
        <div style={chip}>top-3 <b>{top3}%</b></div>
        <div style={chip}>found <b>{found.length}/{done.length || 0}</b></div>
        {scan.status === 'running' &&
          <button onClick={resume} style={{ ...chip, color: '#e5e7eb', cursor: 'pointer' }}>⟳ Resume / kick</button>}
      </div>
      <div ref={mapRef} style={{ height: 640, borderRadius: 12, border: '1px solid #263450' }} />
      <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 12, color: '#8aa0c5' }}>
        {[['#16a34a','1–3'],['#ca8a04','4–10'],['#ea580c','11–20'],['#dc2626','not found'],['#475569','pending']].map(([c, t]) =>
          <span key={t}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: c, marginRight: 5 }} />{t}</span>)}
      </div>
    </main>
  );
}
