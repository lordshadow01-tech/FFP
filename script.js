// FF PAYALUGA — Phase 1: splash, login, register.
import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const INVITE_CODE = "001";               // permanent invite code (also enforce in Firestore rules, Phase 3)
const EMAIL_DOMAIN = "@ffpayaluga.app";  // usernames map to fake emails for Firebase Auth
const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
const $ = id => document.getElementById(id);
const toEmail = name => name.toLowerCase() + EMAIL_DOMAIN;

/* ---- Particles: lightweight canvas, pauses when tab hidden ---- */
function startParticles() {
  const c = $("particles"); if (!c) return;
  const ctx = c.getContext("2d"); let w, h, dots = [];
  const colors = ["#00e5ff", "#a855f7", "#ff8a1f"];
  const resize = () => { w = c.width = innerWidth; h = c.height = innerHeight; };
  resize(); addEventListener("resize", resize);
  dots = Array.from({ length: 40 }, () => ({ x: Math.random() * w, y: Math.random() * h,
    r: Math.random() * 1.8 + .4, v: Math.random() * .4 + .1, c: colors[Math.floor(Math.random() * 3)] }));
  (function frame() {
    if (!document.hidden) {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.y -= d.v; if (d.y < 0) { d.y = h; d.x = Math.random() * w; }
        ctx.fillStyle = d.c; ctx.globalAlpha = .7; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill();
      }
    }
    requestAnimationFrame(frame);
  })();
}

/* ---- UI helpers ---- */
function say(text, ok = false) { const m = $("msg"); m.textContent = text; m.classList.toggle("ok", ok); }
function busy(state, label) { const b = $("submitBtn"); b.disabled = state; if (label) b.textContent = label; }
function friendlyError(e) {
  const map = {
    "auth/email-already-in-use": "That username is taken.",
    "auth/invalid-credential": "Wrong username or password.",
    "auth/user-not-found": "Wrong username or password.",
    "auth/wrong-password": "Wrong username or password.",
    "auth/too-many-requests": "Too many tries. Wait a minute.",
    "auth/network-request-failed": "No internet. Check your connection."
  };
  return map[e.code] || "Something went wrong. Try again.";
}

/* ---- Pages ---- */
function splash() {
  // Wait for the animation, then route by sign-in state.
  const timer = new Promise(r => setTimeout(r, 2300));
  const user = new Promise(r => { const off = onAuthStateChanged(auth, u => { off(); r(u); }); });
  Promise.all([timer, user]).then(([, u]) => { location.replace(u ? "dashboard.html" : "login.html"); });
}

function login() {
  $("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("username").value.trim(), pass = $("password").value;
    if (!USERNAME_RE.test(name)) return say("Username: 3–16 letters, numbers or _.");
    if (!pass) return say("Enter your password.");
    busy(true, "Signing in…"); say("");
    try { await signInWithEmailAndPassword(auth, toEmail(name), pass); location.replace("dashboard.html"); }
    catch (err) { say(friendlyError(err)); busy(false, "Login"); }
  });
}

function register() {
  $("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const code = $("invite").value.trim(), name = $("username").value.trim();
    const pass = $("password").value, confirm = $("confirm").value;
    const phone = ($("phone").value || "").replace(/[\s-]/g, "");
    if (phone && !/^\+?\d{10,13}$/.test(phone)) return say("Mobile number looks wrong.");
    if (code !== INVITE_CODE) return say("Wrong invite code.");
    if (!USERNAME_RE.test(name)) return say("Username: 3–16 letters, numbers or _.");
    if (pass.length < 6) return say("Password needs 6+ characters.");
    if (pass !== confirm) return say("Passwords do not match.");
    busy(true, "Creating…"); say("");
    try {
      const cred = await createUserWithEmailAndPassword(auth, toEmail(name), pass);
      // New accounts are always "member"; promote the admin by hand in the Firebase console.
      await setDoc(doc(db, "users", cred.user.uid), { username: name, role: "member", invite: code, createdAt: serverTimestamp() });
      // Phone goes in its own private doc: only the owner and the admin can read it
      if (phone) await setDoc(doc(db, "phones", cred.user.uid), { phone, username: name, updatedAt: serverTimestamp() }).catch(() => {});
      say("Account created!", true); setTimeout(() => location.replace("dashboard.html"), 700);
    } catch (err) { say(friendlyError(err)); busy(false, "Create account"); }
  });
}

/* ---- Boot ---- */
startParticles();
if (document.body.dataset.page === "dashboard") { /* dashboard.js handles the rest */ }
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("service-worker.js"));
({ splash, login, register })[document.body.dataset.page]?.();
