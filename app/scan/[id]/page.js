'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function getRankColor(r) {
  if (r == null || r === 0) return '#9a1c2b'; // --r0 Not found
  if (r <= 3) return '#22c55e';              // --r1 (1-3)
  if (r <= 6) return '#84cc16';              // --r2 (4-6)
  if (r <= 10) return '#eab308';             // --r3 (7-10)
  if (r <= 15) return '#f97316';             // --r4 (11-15)
  return '#ef4444';                          // --r5 (16-20)
}

function getGrade(score) {
  if (score >= 75) return 'Dominant';
  if (score >= 55) return 'Strong';
  if (score >= 35) return 'Contested';
  if (score >= 18) return 'Weak';
  return 'Invisible';
}

export default function ScanView() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [resuming, setResuming] = useState(false);
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef({});

  const mapReadyRef = useRef(false);

  const refreshMapSize = () => {
    const m = leafletMap.current;
    if (!m) return;
    m.invalidateSize({ animate: false });
  };

  // Poll scan data & auto-tick running scans
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/scan/${id}`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setData(j);
        if (alive && j.scan?.status === 'running') {
          fetch('/api/tick', { method: 'POST' }).catch(() => {});
          setTimeout(load, 4000);
        }
      } catch (e) {
        console.error(e);
      }
    };
    load();
    return () => { alive = false; };
  }, [id]);

  // Leaflet map setup — init once when container is mounted
  useEffect(() => {
    if (!data || mapReadyRef.current || typeof window === 'undefined' || !mapRef.current) return;

    const leafletCssId = 'leaflet-css';
    if (!document.getElementById(leafletCssId)) {
      const css = document.createElement('link');
      css.id = leafletCssId;
      css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(css);
    }

    const initMap = () => {
      if (!window.L || leafletMap.current || !mapRef.current) return;
      const L = window.L;
      const m = L.map(mapRef.current, { zoomControl: true, attributionControl: true })
        .setView([data.scan.center_lat, data.scan.center_lng], 12);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(m);

      L.marker([data.scan.center_lat, data.scan.center_lng], {
        icon: L.divIcon({
          className: '',
          html: '<div style="font-size:24px;line-height:24px;filter:drop-shadow(0 0 6px rgba(56,189,248,.8))">⭐</div>',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      }).addTo(m).bindTooltip(data.scan.gbp_name);

      leafletMap.current = m;
      mapReadyRef.current = true;
      renderMarkers(L, m);
      requestAnimationFrame(() => {
        refreshMapSize();
        requestAnimationFrame(refreshMapSize);
      });
    };

    if (window.L) {
      initMap();
      return;
    }

    const leafletScriptId = 'leaflet-js';
    const existing = document.getElementById(leafletScriptId);
    if (existing) {
      existing.addEventListener('load', initMap, { once: true });
      return;
    }

    const s = document.createElement('script');
    s.id = leafletScriptId;
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = initMap;
    document.head.appendChild(s);
  }, [data]);

  // Keep map sized when the container changes
  useEffect(() => {
    if (!mapRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => refreshMapSize());
    ro.observe(mapRef.current);
    return () => ro.disconnect();
  }, [data]);

  const renderMarkers = (L, m) => {
    if (!data) return;
    const pts = data.points || [];
    const sizes = pts.length > 60 ? 26 : (pts.length > 30 ? 30 : 34);
    const bounds = [];

    for (const p of pts) {
      const isDone = p.state === 'done';
      const rank = isDone ? (p.position > 0 ? p.position : null) : null;
      const c = isDone ? getRankColor(rank) : '#6b7a92';
      const txt = !isDone ? '·' : (rank == null ? '·' : rank);
      const miss = rank == null && isDone ? ' miss' : '';
      const glow = rank != null && rank <= 3 ? `box-shadow: 0 0 14px ${c}, 0 2px 8px rgba(0,0,0,.5);` : '';

      const html = `<div class="pin pop${miss}" style="width:${sizes}px;height:${sizes}px;background:${c};
        font-size:${sizes * 0.42}px;${glow}">${txt}</div>`;
      const icon = L.divIcon({ className: '', html, iconSize: [sizes, sizes], iconAnchor: [sizes / 2, sizes / 2] });

      const packInfo = (p.pack_position == null ? '' : ` · Pack: ${p.pack_position === 0 ? 'out' : '#' + p.pack_position}`) +
        (p.pack_has_ad ? ' (Ad in pack)' : '');

      const videoSrc = p.video_url || null;

      const popupHtml = `
        <div class="pp" style="width:240px;text-align:center;">
          <div class="pt" style="font-size:14px;font-weight:700;letter-spacing:0.04em;">${p.label} — ${p.state}</div>
          <div class="pr" style="justify-content:space-between;display:flex;font-size:11px;color:#94a3b8;margin-bottom:2px;">
            <span>Rank here</span><b style="color:#e2e8f0;">${!isDone ? 'Scanning…' : (rank == null ? 'Not in top 20' : '#' + rank)}</b>
          </div>
          ${p.pack_position != null ? `<div class="pr" style="justify-content:space-between;display:flex;font-size:11px;color:#94a3b8;margin-bottom:6px;"><span>Local Pack</span><b style="color:#e2e8f0;">${p.pack_position === 0 ? 'Outside top 3' : '#' + p.pack_position}</b></div>` : ''}

          <!-- REALISTIC SMARTPHONE FRAME -->
          <div style="margin:8px auto 0 auto;width:220px;background:#090d16;border:2.5px solid #1e293b;border-radius:32px;padding:8px 6px 10px 6px;box-shadow:0 20px 40px rgba(0,0,0,0.8), 0 0 15px rgba(56,189,248,0.15);position:relative;">
            
            <!-- Camera Notch / Island -->
            <div style="width:54px;height:10px;background:#000;border-radius:12px;margin:2px auto 8px auto;display:flex;align-items:center;justify-content:center;gap:5px;">
              <div style="width:4px;height:4px;border-radius:50%;background:#1e293b;"></div>
              <div style="width:3px;height:3px;border-radius:50%;background:#0e7490;"></div>
            </div>

            <!-- Phone Screen Display -->
            <div style="width:100%;height:320px;border-radius:20px;overflow:hidden;background:#000;position:relative;box-shadow:inset 0 0 10px rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;">
              ${videoSrc
                ? `<video controls playsinline width="100%" height="100%" style="object-fit:cover;width:100%;height:100%;display:block;background:#000;" preload="metadata">
                    <source src="${videoSrc}" type="video/mp4">
                  </video>`
                : `<span style="color:#64748b;font-size:11px;padding:12px;text-align:center;">Screen recording processing…<br><span style="font-size:10px;opacity:0.7;">No audio (Android screenrecord, up to 180s)</span></span>`}
            </div>

            <!-- Home Indicator Bar -->
            <div style="width:70px;height:3.5px;background:rgba(255,255,255,0.4);border-radius:10px;margin:8px auto 0 auto;"></div>
          </div>
        </div>
      `;

      if (markersRef.current[p.label]) {
        markersRef.current[p.label].setIcon(icon);
        markersRef.current[p.label].setPopupContent(popupHtml);
      } else {
        markersRef.current[p.label] = L.marker([p.lat, p.lng], { icon })
          .addTo(m)
          .bindPopup(popupHtml);
      }
      bounds.push([p.lat, p.lng]);
    }

    if (bounds.length && !leafletMap.current._fitted) {
      m.fitBounds(bounds, { padding: [70, 70], maxZoom: 14 });
      leafletMap.current._fitted = true;
      requestAnimationFrame(refreshMapSize);
    }
  };

  useEffect(() => {
    if (leafletMap.current && window.L) renderMarkers(window.L, leafletMap.current);
  }, [data]);

  const resume = async () => {
    setResuming(true);
    try {
      await fetch('/api/tick?reset_failed=1', {
        method: 'POST',
        headers: { 'x-admin-key': localStorage.getItem('gg_admin') || '' }
      });
    } catch (e) {
      console.error(e);
    } finally {
      setResuming(false);
    }
  };

  if (!data) {
    return (
      <div id="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)' }}>
        Loading scan grid…
      </div>
    );
  }

  const { scan, points } = data;
  const donePts = points.filter(p => p.state === 'done');
  const foundPts = donePts.filter(p => p.position > 0);
  const total = points.length || 1;

  const avgRank = foundPts.length
    ? (foundPts.reduce((a, p) => a + p.position, 0) / foundPts.length).toFixed(1)
    : '—';

  const top3Pct = donePts.length
    ? Math.round((donePts.filter(p => p.position >= 1 && p.position <= 3).length / donePts.length) * 100)
    : 0;

  const top10Pct = donePts.length
    ? Math.round((donePts.filter(p => p.position >= 1 && p.position <= 10).length / donePts.length) * 100)
    : 0;

  // Visibility score 0-100
  const score = Math.round(
    (points.reduce((acc, p) => {
      const r = p.state === 'done' && p.position > 0 ? p.position : null;
      return acc + (r == null ? 0 : Math.max(0, (21 - Math.min(r, 21)) / 20));
    }, 0) / total) * 100
  );

  const grade = getGrade(score);

  return (
    <div id="app">
      <div className="topbar">
        <Link href="/" className="brand">
          <div className="glyph"><span className="dot"></span></div>
          <div className="txt">
            <div className="name">RANK&nbsp;GRID</div>
            <div className="sub">real-device local visibility</div>
          </div>
        </Link>
        <div className="meta">
          <div className="field">
            <span className="k">Business</span>
            <span className="v" id="mBiz">{scan.gbp_name}</span>
          </div>
          <div className="field">
            <span className="k">Keyword</span>
            <span className="v" id="mKw">{scan.keyword}</span>
          </div>
          <div className="field">
            <span className="k">Captured</span>
            <span className="v" id="mDate">{new Date(scan.created_at).toLocaleDateString()}</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {scan.status === 'running' && (
              <button className="btn ghost" onClick={resume} disabled={resuming}>
                {resuming ? 'Kicking…' : '⟳ Resume / Kick'}
              </button>
            )}
            <Link href="/" className="btn">
              ← New Scan
            </Link>
          </div>
        </div>
      </div>

      <div className="stage">
        <div ref={mapRef} id="map"></div>

        <aside className="panel">
          <div className="head">
            <div className="eyebrow">Local visibility score</div>
            <h1 id="pBiz">{scan.gbp_name}</h1>
            <div className="kw" id="pKw">“{scan.keyword}”</div>
          </div>

          <div className="score">
            <div className="big" id="scoreN">{score}</div>
            <div className="of">/100</div>
            <div className="lab">
              <div className="t" id="scoreGrade">{grade} coverage</div>
            </div>
          </div>

          <div className="bar">
            <i id="scoreBar" style={{ width: `${score}%` }}></i>
          </div>

          <div className="stats">
            <div className="stat">
              <div className="n" id="sAvg">{avgRank}</div>
              <div className="l">Avg rank</div>
            </div>
            <div className="stat">
              <div className="n" id="sTop3">{top3Pct}<small>%</small></div>
              <div className="l">In top 3</div>
            </div>
            <div className="stat">
              <div className="n" id="sTop10">{top10Pct}<small>%</small></div>
              <div className="l">In top 10</div>
            </div>
            <div className="stat">
              <div className="n" id="sPts">{scan.points_done}/{scan.points_total}</div>
              <div className="l">Grid points</div>
            </div>
          </div>

          <div className="legend">
            <div className="lt">Rank at point</div>
            <div className="row">
              <span className="sw" style={{ background: 'var(--r1)' }}></span>
              <span className="rl">Positions <b>1–3</b> · in the pack</span>
            </div>
            <div className="row">
              <span className="sw" style={{ background: 'var(--r2)' }}></span>
              <span className="rl">Positions <b>4–6</b></span>
            </div>
            <div className="row">
              <span className="sw" style={{ background: 'var(--r3)' }}></span>
              <span className="rl">Positions <b>7–10</b></span>
            </div>
            <div className="row">
              <span className="sw" style={{ background: 'var(--r4)' }}></span>
              <span className="rl">Positions <b>11–15</b></span>
            </div>
            <div className="row">
              <span className="sw" style={{ background: 'var(--r5)' }}></span>
              <span className="rl">Positions <b>16–20</b></span>
            </div>
            <div className="row">
              <span className="sw" style={{ background: 'var(--r0)' }}></span>
              <span className="rl"><b>Not found</b> · outside top 20</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
