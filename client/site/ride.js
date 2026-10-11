import { API_BASE, GAME_BASE, SITE_BASE } from '../js/hosts.js';

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60), r = s % 60, h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function extractRideId() {
  const match = location.pathname.match(/\/r\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const url = new URL(location.href);
  return url.searchParams.get('id') || url.searchParams.get('ride');
}

const rideId = extractRideId();
const el = id => document.getElementById(id);

async function load() {
  if (!rideId) {
    el('ride-badge').textContent = 'ERROR';
    el('ride-badge').className = 'badge failed';
    el('ride-title').textContent = 'NO RIDE SPECIFIED';
    el('ride-sub').textContent = 'Provide a ride ID in the path (/r/:id).';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/rides/${encodeURIComponent(rideId)}/public`, { credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.title || `HTTP ${res.status}`);
    }
    const ride = await res.json();
    render(ride);
  } catch (e) {
    el('ride-badge').textContent = 'NOT FOUND';
    el('ride-badge').className = 'badge failed';
    el('ride-title').textContent = 'RIDE NOT FOUND';
    el('ride-sub').textContent = e.message || 'This ride does not exist or has expired.';
  }
}

function render(ride) {
  const isRunning = ride.status === 'running' || ride.status === 'created';
  const isCompleted = ride.status === 'completed';
  const isAbandoned = ride.status === 'abandoned' || (ride.status === 'failed' && (ride.reason || '').toLowerCase().includes('abandon'));
  const isFailed = !isRunning && !isCompleted && !isAbandoned;

  // Badge & Title
  const badge = el('ride-badge');
  if (isRunning) {
    badge.textContent = '● LIVE NOW';
    badge.className = 'badge live';
  } else if (isCompleted) {
    badge.textContent = '✓ COMPLETED';
    badge.className = 'badge complete';
  } else if (isAbandoned) {
    badge.textContent = 'ABANDONED';
    badge.className = 'badge abandoned';
  } else {
    badge.textContent = 'FAILED';
    badge.className = 'badge failed';
  }

  const routeName = ride.route ? ride.route.replace(/[-_]/g, ' ').toUpperCase() : 'HIGHWAY';
  el('ride-title').textContent = `${routeName}`;
  el('ride-sub').textContent = isRunning ? 'Active shift in progress on devnet' : `Shift ended · ${ride.tier.toUpperCase()} tier`;

  el('ride-status').textContent = ride.status.toUpperCase();
  el('ride-distance').textContent = `${(ride.km || 0).toFixed(2)} km`;
  el('ride-time').textContent = fmt(ride.driveSeconds);
  el('ride-tier').textContent = (ride.tier || 'free').toUpperCase();
  el('ride-wallet').textContent = ride.wallet || 'Anonymous';

  // Server verdict
  if (ride.verdict) {
    el('row-verdict').style.display = 'flex';
    const status = ride.verdict.status.toUpperCase();
    const reasons = (ride.verdict.reasons || []).join('; ');
    el('ride-verdict').textContent = reasons ? `${status} (${reasons})` : status;
    el('ride-verdict').className = ride.verdict.status === 'verified' ? 'good' : 'bad';
  }

  // Blockchain proof / receipt
  const chainBox = el('chain-box');
  chainBox.style.display = 'block';

  if (ride.paymentSignature) {
    el('row-tx').style.display = 'flex';
    const txLink = document.createElement('a');
    txLink.href = `https://explorer.solana.com/tx/${encodeURIComponent(ride.paymentSignature)}?cluster=devnet`;
    txLink.target = '_blank';
    txLink.rel = 'noopener noreferrer';
    const sig = ride.paymentSignature;
    txLink.textContent = sig.length > 20 ? `${sig.slice(0, 8)}…${sig.slice(-8)}` : sig;
    el('ride-tx').replaceChildren(txLink);
  }

  if (ride.seed != null) {
    el('ride-seed').textContent = '0x' + (ride.seed >>> 0).toString(16);
  }
  if (ride.seedSlot != null) {
    el('row-slot').style.display = 'flex';
    el('ride-slot').textContent = `#${ride.seedSlot}`;
  }

  // Action buttons
  const isFree = (ride.tier || 'free') === 'free';
  const btnWatch = el('btn-watch');
  if (isRunning && isFree) {
    btnWatch.style.display = 'none';
  } else {
    btnWatch.style.display = 'block';
    btnWatch.textContent = isRunning ? 'WATCH LIVE STREAM' : 'WATCH REPLAY';
    btnWatch.onclick = () => {
      location.href = `${GAME_BASE}/play.html?watch=${encodeURIComponent(ride.id)}`;
    };
  }

  const btnShareX = el('btn-share-x');
  btnShareX.style.display = 'inline-flex';
  btnShareX.onclick = () => {
    const url = `${SITE_BASE}/r/${encodeURIComponent(ride.id)}`;
    let text = '';
    if (isRunning) {
      text = isFree
        ? `Driving on ${routeName} in @FreightChainSol! 🚛 Currently ${(ride.km || 0).toFixed(1)} km in (${fmt(ride.driveSeconds)}). Follow along on @solana devnet: `
        : `Driving on ${routeName} in @FreightChainSol! 🚛 Currently ${(ride.km || 0).toFixed(1)} km in (${fmt(ride.driveSeconds)}). Watch me live or send a roadside tip on @solana devnet: `;
    } else if (isCompleted) {
      const vText = ride.verdict?.status === 'verified' ? 'COMPLETED (VERIFIED)' : 'COMPLETED';
      text = `Just finished a ${ride.tier} shift on ${routeName} in @FreightChainSol! 🚛 ${(ride.km || 0).toFixed(2)} km driven · ${vText} · devnet pool. Check receipt on @solana: `;
    } else {
      text = `Drove ${(ride.km || 0).toFixed(1)} km on ${routeName} in @FreightChainSol! 🚛 Watch the replay: `;
    }
    const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(intent, '_blank', 'noopener,noreferrer');
  };

  el('btn-take-wheel').onclick = () => {
    location.href = `${GAME_BASE}/play.html`;
  };
}

load();
