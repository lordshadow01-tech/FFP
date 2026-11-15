// FF PAYALUGA dashboard: presence, alarms, responses, members, announcements, notifications.
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, orderBy, limit, onSnapshot, serverTimestamp, Timestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const VAPID_KEY = "YOUR_WEB_PUSH_KEY"; // Firebase Console > Project settings > Cloud Messaging > Web push certificates
const ONLINE_MS = 75000;
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const hm = d => pad(d.getHours()) + ":" + pad(d.getMinutes());
// Safe DOM builder: text always goes in as text, never as HTML.
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === "class" ? e.className = v : k.startsWith("on") ? e.addEventListener(k.slice(2), v) : e.setAttribute(k, v);
  e.append(...kids); return e;
};

let me, members = [], alarms = [], news = [], editing = null;
const responses = {}, subscribed = new Set(), dismissed = new Set();
const isAdmin = () => me?.role === "admin";
const isOnline = m => m.lastSeen?.toMillis && Date.now() - m.lastSeen.toMillis() < ONLINE_MS;
const lastSeen = m => !m.lastSeen?.toMillis ? "never" : (d => (d.toDateString() === new Date().toDateString() ? "today " : d.toLocaleDateString() + " ") + hm(d))(m.lastSeen.toDate());

/* ---- Boot: only signed-in members get in ---- */
onAuthStateChanged(auth, async u => {
  if (!u) return location.replace("login.html");
  const snap = await getDoc(doc(db, "users", u.uid));
  if (!snap.exists()) { await signOut(auth); return location.replace("login.html"); }
  me = { uid: u.uid, ...snap.data() };
  start();
});

function start() {
  $("alarmForm").hidden = $("newsForm").hidden = !isAdmin();
  beat(); setInterval(beat, 30000);
  document.addEventListener("visibilitychange", () => !document.hidden && beat());
  onSnapshot(collection(db, "users"), s => { members = s.docs.map(d => ({ uid: d.id, ...d.data() })); me.role = members.find(m => m.uid === me.uid)?.role || me.role; renderAll(); });
  onSnapshot(query(collection(db, "alarms"), orderBy("at", "desc"), limit(30)), s => {
    alarms = s.docs.map(d => ({ id: d.id, ...d.data() }));
    alarms.slice(0, 15).forEach(a => {
      if (subscribed.has(a.id)) return; subscribed.add(a.id);
      onSnapshot(collection(db, "alarms", a.id, "responses"), r => { responses[a.id] = Object.fromEntries(r.docs.map(x => [x.id, x.data()])); renderAll(); });
    });
    renderAll();
  });
  onSnapshot(query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(20)), s => { news = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); });
  setInterval(tick, 1000); tick();
}
const beat = () => updateDoc(doc(db, "users", me.uid), { lastSeen: serverTimestamp() }).catch(() => {});

/* ---- Clock + alarm trigger ---- */
function tick() {
  const n = new Date(); $("clock").textContent = hm(n) + ":" + pad(n.getSeconds());
  const t = Date.now();
  const due = alarms.find(a => { const at = a.at.toMillis(); return t >= at && t - at < 600000 && !responses[a.id]?.[me.uid] && !dismissed.has(a.id); });
  due ? ring(due) : stopRing();
}

/* ---- Ringing screen: only COMING / VARALA ---- */
let ac, beepTimer, ringing = null;
function beep() { ac ??= new AudioContext(); ac.resume(); const o = ac.createOscillator(), g = ac.createGain(); o.type = "square"; o.frequency.value = 880; g.gain.value = .25; o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + .25); }
function ring(a) {
  if (ringing === a.id) return; ringing = a.id;
  $("ringTitle").textContent = a.title; $("ringDesc").textContent = (a.description || "") + " · " + hm(a.at.toDate());
  $("ring").hidden = false;
  try { beep(); } catch {}
  beepTimer = setInterval(() => { try { beep(); } catch {} navigator.vibrate?.([300, 150, 300]); }, 900);
}
function stopRing() { if (!ringing) return; ringing = null; clearInterval(beepTimer); $("ring").hidden = true; }
async function respond(kind) {
  const id = ringing; if (!id) return; dismissed.add(id); stopRing();
  await setDoc(doc(db, "alarms", id, "responses", me.uid), { username: me.username, response: kind, respondedAt: serverTimestamp(), status: "responded" });
}
$("bComing").onclick = () => respond("coming"); $("bVarala").onclick = () => respond("varala");

/* ---- Rendering ---- */
function renderAll() { renderHome(); renderAlarms(); renderMembers(); renderNews(); renderMenu(); }
function renderHome() {
  const on = members.filter(isOnline).length;
  $("onlineCount").textContent = `Online ${on} · Offline ${members.length - on}`;
  const now = Date.now();
  const next = alarms.filter(a => a.at.toMillis() > now).sort((a, b) => a.at - b.at)[0];
  const recent = alarms.find(a => a.at.toMillis() <= now && now - a.at.toMillis() < 3600000);
  $("nextAlarm").replaceChildren(next ? h("div", {}, h("b", {}, next.title), ` at ${hm(next.at.toDate())}`, next.description ? ` · ${next.description}` : "") : "No alarm set");
  const focus = recent || next, r = Object.values(responses[focus?.id] || {});
  const c = r.filter(x => x.response === "coming").length, v = r.filter(x => x.response === "varala").length;
  $("stats").replaceChildren(...[["c", "Coming", c], ["v", "Varala", v], ["p", "Pending", Math.max(0, members.length - c - v)]].map(([k, l, n]) => h("div", { class: "stat " + k }, h("b", {}, String(n)), l)));
  $("latestNews").textContent = news[0]?.text || "Nothing yet";
}
function renderAlarms() {
  $("alarmList").replaceChildren(...alarms.map(a => {
    const r = Object.values(responses[a.id] || {}), names = k => r.filter(x => x.response === k).map(x => x.username).join(", ") || "-";
    const row = h("div", { class: "row" }, h("div", { class: "top" }, h("b", {}, a.title), h("span", { class: "badge" }, a.at.toDate().toLocaleDateString() + " " + hm(a.at.toDate()))),
      h("div", { class: "sub" }, `${a.description || ""} · by ${a.creator}`), h("div", {}, `Coming: ${names("coming")}`), h("div", {}, `Varala: ${names("varala")}`));
    if (isAdmin()) row.append(h("div", { class: "mini" }, h("button", { onclick: () => editAlarm(a) }, "Edit"), h("button", { onclick: () => confirm("Delete alarm?") && deleteDoc(doc(db, "alarms", a.id)) }, "Delete")));
    return row;
  }));
}
function renderMembers() {
  $("memberList").replaceChildren(...[...members].sort((a, b) => isOnline(b) - isOnline(a)).map(m => {
    const row = h("div", { class: "row" }, h("div", { class: "top" }, h("span", { class: "dot" + (isOnline(m) ? " on" : "") }), h("b", {}, m.username), h("span", { class: "badge" }, m.role)),
      h("div", { class: "sub" }, isOnline(m) ? "Online" : "Last seen " + lastSeen(m)));
    if (isAdmin() && m.uid !== me.uid) row.append(h("div", { class: "mini" },
      h("button", { onclick: () => updateDoc(doc(db, "users", m.uid), { role: m.role === "admin" ? "member" : "admin" }) }, m.role === "admin" ? "Make member" : "Make admin"),
      h("button", { onclick: () => confirm("Remove " + m.username + "?") && deleteDoc(doc(db, "users", m.uid)) }, "Remove")));
    return row;
  }));
}
function renderNews() {
  $("newsList").replaceChildren(...news.map(n => {
    const row = h("div", { class: "row" }, h("div", {}, n.text), h("div", { class: "sub" }, `${n.by} · ${n.createdAt?.toDate ? n.createdAt.toDate().toLocaleString() : ""}`));
    if (isAdmin()) row.append(h("div", { class: "mini" }, h("button", { onclick: () => deleteDoc(doc(db, "announcements", n.id)) }, "Delete")));
    return row;
  }));
}
function renderMenu() {
  const names = list => list.length ? list.map(m => m.username).join(", ") : "-";
  $("menu").replaceChildren(h("h3", {}, `Registered members (${members.length})`), h("div", {}, names(members)),
    h("h3", {}, "Admin"), h("div", {}, names(members.filter(m => m.role === "admin"))),
    h("h3", {}, "Online users"), h("div", {}, names(members.filter(isOnline))),
    h("h3", {}, "Offline users"), h("div", {}, names(members.filter(m => !isOnline(m)))),
    h("button", { onclick: () => alert("FF PAYALUGA (FFP) v1.0\nSquad alarm for the crew.") }, "About"),
    h("button", { onclick: async () => { await updateDoc(doc(db, "users", me.uid), { lastSeen: Timestamp.fromMillis(0) }).catch(() => {}); await signOut(auth); location.replace("login.html"); } }, "Logout"));
}

/* ---- Navigation + menu ---- */
$("nav").onclick = e => { const v = e.target.dataset.v; if (!v) return; document.querySelectorAll(".view").forEach(s => s.hidden = s.id !== "v-" + v); document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("on", b === e.target)); };
$("menuBtn").onclick = e => { e.stopPropagation(); $("menu").hidden = !$("menu").hidden; };
document.addEventListener("click", e => { if (!$("menu").contains(e.target)) $("menu").hidden = true; });

/* ---- Admin: create / edit alarm (validated here AND by Firestore rules) ---- */
function editAlarm(a) { editing = a.id; $("formTitle").textContent = "Edit alarm"; $("aTitle").value = a.title; $("aTime").value = hm(a.at.toDate()); $("aDesc").value = a.description || ""; $("aCancel").hidden = false; scrollTo(0, 0); }
function resetForm() { editing = null; $("alarmForm").reset(); $("formTitle").textContent = "Create alarm"; $("aCancel").hidden = true; }
$("aCancel").onclick = resetForm;
$("alarmForm").onsubmit = async e => {
  e.preventDefault(); if (!isAdmin()) return;
  const title = $("aTitle").value.trim(), t = $("aTime").value, desc = $("aDesc").value.trim();
  if (!title || title.length > 40) return ($("aMsg").textContent = "Title: 1–40 characters.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return ($("aMsg").textContent = "Pick a time in 24h format.");
  const at = new Date(); const [H, M] = t.split(":").map(Number); at.setHours(H, M, 0, 0); if (at <= new Date() && !editing) at.setDate(at.getDate() + 1);
  const data = { title, description: desc.slice(0, 120), at: Timestamp.fromDate(at), creator: me.username, notified: false };
  try { editing ? await updateDoc(doc(db, "alarms", editing), data) : await addDoc(collection(db, "alarms"), { ...data, createdAt: serverTimestamp() }); resetForm(); $("aMsg").textContent = ""; }
  catch { $("aMsg").textContent = "Could not save. Admin only."; }
};
$("newsForm").onsubmit = async e => {
  e.preventDefault(); const text = $("nText").value.trim(); if (!text || text.length > 200) return;
  await addDoc(collection(db, "announcements"), { text, by: me.username, createdAt: serverTimestamp() }); $("nText").value = "";
};

/* ---- Settings: push notifications, sound test, install ---- */
$("soundBtn").onclick = () => { try { beep(); navigator.vibrate?.(300); } catch {} };
$("notifBtn").onclick = async () => {
  try {
    if (await Notification.requestPermission() !== "granted") return ($("sMsg").textContent = "Notification permission denied.");
    const { getMessaging, getToken } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js");
    const { getApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const reg = await navigator.serviceWorker.register("firebase-messaging-sw.js");
    const token = await getToken(getMessaging(getApp()), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    await updateDoc(doc(db, "users", me.uid), { fcmToken: token }); $("sMsg").textContent = "Notifications enabled.";
  } catch { $("sMsg").textContent = "Could not enable notifications. Check the VAPID key."; }
};
let installEvt; addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("installBtn").hidden = false; });
$("installBtn").onclick = async () => { installEvt?.prompt(); installEvt = null; $("installBtn").hidden = true; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js");
