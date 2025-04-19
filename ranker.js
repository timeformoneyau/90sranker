/* ---------- Base Reset ---------- */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
body {
  background: linear-gradient(135deg, #1b2735, #090a0f);
  color: #eee;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  display: flex;
  justify-content: center;
  padding: 2rem;
  min-height: 100vh;
}
/* ---------- App Container ---------- */
.app {
  max-width: 900px;
  width: 100%;
  background: #1f1f2e;
  border-radius: 10px;
  box-shadow: 0 8px 20px rgba(0,0,0,0.7);
  padding: 2rem;
}
header {
  text-align: center;
  margin-bottom: 2rem;
}
h1 {
  font-size: 2.5rem;
  color: #ffd700;
  font-family: 'Monoton', cursive;
  text-shadow: 0 0 8px rgba(255,215,0,0.8);
}
.tagline {
  margin-top: .5rem;
  font-size: 1.1rem;
  color: #bbb;
  font-style: italic;
}
/* ---------- Compare Section ---------- */
.compare {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.vs-badge {
  font-size: 1.2rem;
  color: #bbb;
  margin-top: 2rem;
}
/* ---------- Poster Cards ---------- */
.poster-card {
  background: #2a2a3d;
  padding: 1rem;
  border: 4px dashed #444;
  border-radius: 8px;
  width: 45%;
  text-align: center;
  box-shadow: inset 0 0 10px rgba(0,0,0,0.5), 0 4px 8px rgba(0,0,0,0.3);
  position: relative;    /* needed so confetti-container can sit absolutely */
  overflow: visible;     /* Allow confetti to extend beyond card */
}
.poster {
  width: 100%;
  height: auto;
  border-radius: 4px;
  margin-bottom: .75rem;
  display: block;
}
.title {
  margin-bottom: 1rem;
  font-weight: bold;
  color: #ddd;
}
/* ---------- Confetti Containers ---------- */
.confetti-container {
  pointer-events: none;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 10;  /* Increased to ensure confetti appears above other elements */
  overflow: visible; /* Allow confetti to extend beyond container */
}

/* Confetti pieces styling */
.confetti-piece {
  position: absolute;
  width: 10px; 
  height: 15px;
  border-radius: 3px;
  top: 50%;
  left: 50%;
  opacity: 1;
  z-index: 10;
}

/* ---------- Buttons & Hover Animations ---------- */
.btn {
  display: block;
  width: 100%;
  padding: .75rem;
  margin: .5rem 0;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  cursor: pointer;
  transition: transform .2s, box-shadow .2s;
}

/* HOVER REPLACED with active hover state */
.btn:hover {
  transform: scale(1.05) translateY(-5px);
  box-shadow: 0 5px 15px rgba(0,0,0,0.3);
}

/* Primary: Neon‑style "Pick Winner" */
.primary {
  background: linear-gradient(45deg, #7f5af0, #c77dff);
  color: #fff;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  z-index: 2;
}
/* Tertiary: Concession yellow */
.tertiary {
  background: #ffe066;
  color: #4a3210;
  font-weight: bold;
  z-index: 2;
}
/* ---------- Footer ---------- */
footer {
  text-align: center;
  margin-top: 2rem;
}
.view-full {
  color: #7f5af0;
  text-decoration: none;
  font-weight: bold;
}
.view-full:hover {
  text-decoration: underline;
}
/* ---------- Responsive ---------- */
@media (max-width: 768px) {
  .compare {
    flex-direction: column;
    align-items: center;
  }
  .poster-card {
    width: 80%;
  }
  .vs-badge {
    margin: 1.5rem 0;
  }
}
.poster-link {
  display: block;
  text-decoration: none;
  color: inherit;
}

/* Improved confetti animation */
@keyframes confettiBurst {
  0% {
    transform: translate(-50%, -50%) rotate(0deg);
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
  100% {
    transform: translate(var(--random-x), var(--random-y)) rotate(var(--random-rotate));
    opacity: 0;
  }
}

/* Add animation for poster shake effect */
@keyframes popcorn-shake {
  0% { transform: rotate(0deg) scale(1); }
  25% { transform: rotate(-5deg) scale(1.05); }
  50% { transform: rotate(5deg) scale(1.1); }
  75% { transform: rotate(-5deg) scale(1.05); }
  100% { transform: rotate(0deg) scale(1); }
}

.popcorn-shake {
  animation: popcorn-shake 0.7s ease;
}
