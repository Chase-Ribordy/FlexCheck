<!-- 🔥 WEEKLY SNAPCHECK COUNTDOWN -->
<div id="weekly-countdown" style="
  position: relative;
  text-align: center;
  padding: 3rem 1.5rem;
  background: #0f172a;
  border-radius: 1rem;
  border: 1px solid #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.01);
  max-width: 700px;
  margin: 2rem auto;
  overflow: hidden;
  font-family: 'Hemi Head', 'Inter', sans-serif;
">

  <!-- 🔷 Background Logo -->
  <img src="https://www.gameplanfitness.com/wp-content/uploads/2025/07/GP_2024_logo300x223.webp" alt="GamePlan Logo" style="
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 70%;
max-width: 300px;
    opacity: 0.04;
    z-index: 0;
    pointer-events: none;
  ">

  <!-- ⏱️ Countdown Timer -->
 <div id="weekly-timer" style="
  font-size: 3.5rem;
  font-weight: 800;
  color: #38bdf8;
  text-shadow: 0 0 3px #38bdf8;
  z-index: 1;
  position: relative;
">
00:00:00</div>

  <!-- 📝 Caption -->
  <p style="
    color: #cbd5e1;
    font-weight: 500;
    font-size: 0.75rem;
    margin-top: 0.75rem;
    z-index: 1;
    position: relative;
  ">Submissions close every <span style="color:#38bdf8; font-weight:600;">Thursday @ 7PM CT</span></p>
</div>

<!-- 💥 Weekly Deadline Countdown (Thu 7:00 PM America/Chicago) -->
<script>
  // ---- Time helpers (America/Chicago safe across DST) ----
  function nowInCT() {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
    return new Date(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      0
    );
  }

  function getNextThursdayAt7pmCT() {
    const now = nowInCT();
    const day = now.getDay();           // 0=Sun ... 4=Thu
    const next = new Date(now);
    next.setHours(19, 0, 0, 0);         // 7:00 PM CT today
    const daysUntilThu = (4 - day + 7) % 7; // distance to Thursday
    if (daysUntilThu === 0 && now.getHours() >= 19) {
      next.setDate(now.getDate() + 7);  // already past 7pm Thu → next week
    } else {
      next.setDate(now.getDate() + daysUntilThu);
    }
    return next;
  }

  // ---- Countdown ----
  function updateCountdown() {
    const el = document.getElementById('weekly-timer');
    if (!el) return;

    const target = getNextThursdayAt7pmCT();
    const now = nowInCT();
    const diff = target - now;

    if (diff <= 0) {
      el.innerText = "00:00:00";
      return;
    }
    const h  = String(Math.floor(diff / 3.6e6)).padStart(2, '0');
    const m  = String(Math.floor((diff % 3.6e6) / 6e4)).padStart(2, '0');
    const s  = String(Math.floor((diff % 6e4) / 1000)).padStart(2, '0');
    el.innerText = `${h}:${m}:${s}`;
  }

  // Start ticking
  updateCountdown();
  const _weeklyTimerInterval = setInterval(updateCountdown, 1000);

  // ---- Flash effects (optional) ----
  window.addEventListener('DOMContentLoaded', () => {
    const timer = document.getElementById('weekly-timer');
    if (!timer) return;
    timer.classList.add('flash-once');
    setTimeout(() => timer.classList.remove('flash-once'), 600);
  });

  document.addEventListener('click', (e) => {
    const timer = document.getElementById('weekly-timer');
    if (!timer || !timer.contains(e.target)) return;
    timer.classList.remove('flash-once'); // reset if already running
    void timer.offsetWidth;               // force reflow
    timer.classList.add('flash-once');
    setTimeout(() => timer.classList.remove('flash-once'), 600);
  });
</script>


<!-- ⚡ Animation Styles -->
<style>
@keyframes crystalFlash {
  0%, 100% {
    color: #38bdf8;
    text-shadow: 0 0 12px #38bdf8;
  }
  50% {
    color: #60a5fa;
    text-shadow: 0 0 18px #60a5fa;
  }
}

.flash-once {
  animation: crystalFlash 0.5s ease-in-out;
}
</style>