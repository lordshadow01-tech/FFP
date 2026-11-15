// FF PAYALUGA dashboard: presence, alarms, responses, members, announcements, notifications.
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, orderBy, limit, onSnapshot, getDocs, where, serverTimestamp, Timestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const VAPID_KEY = "BEsmov8HdLo4LJaKi4eS1gjvfwI_OBIH2QqsK928z0eczk8OuLf1fwSIst8XWehwDU8RXwTa9Gvvz6cJ388rGdg"; // Firebase Console > Project settings > Cloud Messaging > Web push certificates
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

let me, members = [], alarms = [], news = [], editing = null, alarmSound = null, audioEl = null, phones = {}, phonesOn = false;
const responses = {}, subscribed = new Set(), dismissed = new Set();
const isAdmin = () => me?.role === "admin";
// Members may create alarms only when the admin gave them a daily limit (alarmLimit 1-20)
const myLimit = () => Number(members.find(m => m.uid === me?.uid)?.alarmLimit ?? me?.alarmLimit ?? 0);
const canCreate = () => isAdmin() || myLimit() > 0;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const usedToday = () => alarms.filter(a => a.creatorUid === me.uid && a.createdAt?.toMillis?.() >= startOfToday()).length;
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
  onSnapshot(doc(db, "settings", "alarm"), s => { soundName = s.data()?.sound || "classic"; renderSound(); });
  onSnapshot(query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(20)), s => { news = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); });
  onSnapshot(doc(db, "config", "alarm"), s => { alarmSound = s.exists() ? s.data() : null; $("soundName").textContent = alarmSound?.name || "Default beep"; });
  getDoc(doc(db, "phones", me.uid)).then(s => s.exists() && ($("phoneIn").value = s.data().phone)).catch(() => {});
  checkGate();
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
let ac, beepTimer, ringing = null, soundName = "classic", wake = null;
/* Alarm sounds are generated in the browser, so no audio files are needed. Admin picks one for everybody. */
function tone(f, t0, d, type = "square", g = .25, f2 = f) {
  const o = ac.createOscillator(), v = ac.createGain(), t = ac.currentTime + t0;
  o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f2, t + d);
  v.gain.value = g; o.connect(v).connect(ac.destination); o.start(t); o.stop(t + d);
}
const SOUNDS = {
  classic: { label: "Classic beep", play: () => tone(880, 0, .25) },
  siren: { label: "Siren", play: () => { tone(600, 0, .45, "sawtooth", .2, 1200); tone(1200, .45, .45, "sawtooth", .2, 600); } },
  digital: { label: "Digital triple", play: () => [0, .15, .3].forEach(t => tone(1400, t, .1, "square", .2)) },
  alert: { label: "Game alert", play: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .15, .14, "triangle", .35)) },
  pulse: { label: "Deep pulse", play: () => { tone(220, 0, .35, "sawtooth", .3); tone(330, .4, .35, "sawtooth", .3); } }
};
function beep() { ac ??= new AudioContext(); ac.resume(); (SOUNDS[soundName] || SOUNDS.classic).play(); }
function renderSound() {
  const sel = $("soundSel");
  if (!sel.options.length) sel.replaceChildren(...Object.entries(SOUNDS).map(([k, v]) => h("option", { value: k }, v.label)));
  sel.value = soundName; sel.disabled = !isAdmin();
  $("soundNote").textContent = isAdmin() ? "Your choice rings for every member." : "Only the admin can change this.";
}
$("soundSel").onchange = () => setDoc(doc(db, "settings", "alarm"), { sound: $("soundSel").value, by: me.username }, { merge: true }).catch(() => ($("sMsg").textContent = "Only admin can change the sound."));
// Custom alarm sound chosen by the admin (stored in Firestore, same for everyone)
function playSound() { audioEl?.pause(); audioEl = new Audio(alarmSound.data); audioEl.loop = true; audioEl.play().catch(() => {}); }
function stopSound() { audioEl?.pause(); audioEl = null; }
function ring(a) {
  if (ringing === a.id) return; ringing = a.id;
  $("ringTitle").textContent = a.title; $("ringDesc").textContent = [a.description, hm(a.at.toDate()), a.creator && "by " + a.creator].filter(Boolean).join(" · ");
  $("ring").hidden = false;
  // App in background: pop a notification too, and keep the screen on while ringing
  if (document.hidden && "Notification" in window && Notification.permission === "granted") navigator.serviceWorker.ready.then(r => r.showNotification("⏰ " + a.title, { body: [a.description, hm(a.at.toDate())].filter(Boolean).join(" · "), tag: a.id, requireInteraction: true, vibrate: [500, 250, 500, 250, 500], icon: "icon-192.png", data: { url: "dashboard.html" } })).catch(() => {});
  navigator.wakeLock?.request("screen").then(l => (wake = l)).catch(() => {});
  alarmSound?.data ? playSound() : (() => { try { beep(); } catch {} })();
  beepTimer = setInterval(() => { if (!alarmSound?.data) { try { beep(); } catch {} } navigator.vibrate?.([300, 150, 300]); }, 900);
}
function stopRing() { if (!ringing) return; ringing = null; clearInterval(beepTimer); stopSound(); wake?.release?.(); wake = null; $("ring").hidden = true; }
async function respond(kind) {
  const id = ringing; if (!id) return; dismissed.add(id); stopRing();
  await setDoc(doc(db, "alarms", id, "responses", me.uid), { username: me.username, response: kind, respondedAt: serverTimestamp(), status: "responded" });
}
$("bComing").onclick = () => respond("coming"); $("bVarala").onclick = () => respond("varala");

/* ---- Rendering ---- */
function renderAll() {
  $("soundAdmin").hidden = !isAdmin();
  $("alarmForm").hidden = !canCreate(); $("newsForm").hidden = !isAdmin();
  $("limitNote").textContent = !isAdmin() && canCreate() ? `Your daily limit: ${usedToday()} / ${myLimit()} used today` : "";
  if (isAdmin() && !phonesOn) { // phone numbers are readable by the admin only
    phonesOn = true;
    onSnapshot(collection(db, "phones"), s => { phones = Object.fromEntries(s.docs.map(d => [d.id, d.data().phone])); renderMembers(); });
  }
  renderSound(); renderHome(); renderAlarms(); renderMembers(); renderNews(); renderMenu(); renderReplies(); }
// Who is coming / varala for the current (or next) alarm, shown on Home and News
function renderReplies() {
  const now = Date.now();
  const a = alarms.find(x => x.at.toMillis() <= now && now - x.at.toMillis() < 3600000) || alarms.filter(x => x.at.toMillis() > now).sort((p, q) => p.at - q.at)[0];
  const build = () => !a ? [] : [h("div", { class: "row" }, h("div", { class: "top" }, h("b", {}, `${a.title} · ${hm(a.at.toDate())}`), h("span", { class: "badge" }, "Replies")),
    ...members.map(m => { const r = responses[a.id]?.[m.uid]?.response; return h("div", {}, `${m.username} — `, h("b", {}, r === "coming" ? "Coming" : r === "varala" ? "Varala" : "Pending")); }))];
  $("replies").replaceChildren(...build()); $("newsReplies").replaceChildren(...build());
}
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
    if (isAdmin() && phones[m.uid]) row.append(h("a", { class: "sub", href: "tel:" + phones[m.uid] }, "📞 " + phones[m.uid]));
    if (isAdmin() && m.role !== "admin") row.append(h("label", { class: "limit" }, "Alarms per day",
      h("select", { onchange: e => updateDoc(doc(db, "users", m.uid), { alarmLimit: Number(e.target.value) }) },
        ...Array.from({ length: 21 }, (_, n) => h("option", n === Number(m.alarmLimit || 0) ? { value: n, selected: "" } : { value: n }, n ? String(n) : "Off")))));
    if (isAdmin() && m.uid !== me.uid) row.append(h("div", { class: "mini" },
      h("button", { onclick: () => { if (m.role !== "admin" && prompt("Enter passcode to make admin") !== "4047") return alert("Wrong passcode"); updateDoc(doc(db, "users", m.uid), { role: m.role === "admin" ? "member" : "admin" }); } }, m.role === "admin" ? "Make member" : "Make admin"),
      h("button", { onclick: () => confirm("Remove " + m.username + "?") && Promise.all([deleteDoc(doc(db, "users", m.uid)), deleteDoc(doc(db, "phones", m.uid))]).catch(() => {}) }, "Remove")));
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
  e.preventDefault(); if (!canCreate()) return;
  const title = $("aTitle").value.trim(), t = $("aTime").value, desc = $("aDesc").value.trim();
  if (!title || title.length > 40) return ($("aMsg").textContent = "Title: 1–40 characters.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return ($("aMsg").textContent = "Pick a time in 24h format.");
  const at = new Date(); const [H, M] = t.split(":").map(Number); at.setHours(H, M, 0, 0); if (at <= new Date() && !editing) at.setDate(at.getDate() + 1);
  const data = { title, description: desc.slice(0, 120), at: Timestamp.fromDate(at), creator: me.username, notified: false };
  if (!isAdmin()) { // re-count from the server so the limit can't be dodged by a stale screen
    const snap = await getDocs(query(collection(db, "alarms"), where("creatorUid", "==", me.uid)));
    const used = snap.docs.filter(d => d.data().createdAt?.toMillis?.() >= startOfToday()).length;
    if (used >= myLimit()) return ($("aMsg").textContent = `Daily limit reached (${used}/${myLimit()}).`);
  }
  try { editing ? await updateDoc(doc(db, "alarms", editing), data) : await addDoc(collection(db, "alarms"), { ...data, createdAt: serverTimestamp(), creatorUid: me.uid }); resetForm(); $("aMsg").textContent = ""; }
  catch { $("aMsg").textContent = "Could not save. Ask the admin for permission."; }
};
$("newsForm").onsubmit = async e => {
  e.preventDefault(); const text = $("nText").value.trim(); if (!text || text.length > 200) return;
  await addDoc(collection(db, "announcements"), { text, by: me.username, createdAt: serverTimestamp() }); $("nText").value = "";
};

/* ---- Settings: push notifications, sound test, install ---- */
$("soundBtn").onclick = () => { if (alarmSound?.data) { playSound(); setTimeout(stopSound, 5000); } else { try { beep(); navigator.vibrate?.(300); } catch {} } };

// Turn any song into a short mono WAV (first 15 s) so it fits in one Firestore document
async function toWavDataUrl(file) {
  const dec = await new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(await file.arrayBuffer());
  const rate = 16000, len = Math.floor(rate * Math.min(15, dec.duration));
  const off = new OfflineAudioContext(1, len, rate), src = off.createBufferSource();
  src.buffer = dec; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const wav = new DataView(new ArrayBuffer(44 + len * 2)), w = (o, t) => [...t].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); wav.setUint32(4, 36 + len * 2, true); w(8, "WAVEfmt "); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
  wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); w(36, "data"); wav.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  const bytes = new Uint8Array(wav.buffer); let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return "data:audio/wav;base64," + btoa(bin);
}
$("pickSound").onclick = () => $("soundFile").click();
$("soundFile").onchange = async e => {
  const f = e.target.files[0]; if (!f || !isAdmin()) return;
  $("sMsg").textContent = "Processing song…";
  try {
    await setDoc(doc(db, "config", "alarm"), { name: f.name.slice(0, 60), data: await toWavDataUrl(f), by: me.username, updatedAt: serverTimestamp() });
    $("sMsg").textContent = "Alarm sound updated for everyone.";
  } catch { $("sMsg").textContent = "Could not use that file. Try another song."; }
  e.target.value = "";
};
$("resetSound").onclick = () => deleteDoc(doc(db, "config", "alarm")).then(() => ($("sMsg").textContent = "Back to default beep."));
$("phoneBtn").onclick = async () => {
  const p = $("phoneIn").value.replace(/[\s-]/g, "");
  if (!/^\+?\d{10,13}$/.test(p)) return ($("sMsg").textContent = "Enter a valid mobile number.");
  try { await setDoc(doc(db, "phones", me.uid), { phone: p, username: me.username, updatedAt: serverTimestamp() }); $("sMsg").textContent = "Number saved."; }
  catch { $("sMsg").textContent = "Could not save the number."; }
};
async function enableNotifications() { // asks permission, then saves this phone's push token
  if ((await Notification.requestPermission()) !== "granted") throw new Error("denied");
  const { getMessaging, getToken } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js");
  const { getApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  await navigator.serviceWorker.register("service-worker.js");
  const reg = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(getApp()), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  await updateDoc(doc(db, "users", me.uid), { fcmToken: token });
}
$("notifBtn").onclick = async () => {
  try { await enableNotifications(); $("sMsg").textContent = "Notifications enabled."; }
  catch { $("sMsg").textContent = "Could not enable notifications. Check the permission."; }
};
/* ---- Gate: nobody sees the app until notifications are allowed ---- */
let tokenDone = false;
const needsGate = () => "Notification" in window && Notification.permission !== "granted";
function checkGate() {
  const need = needsGate(); $("gate").hidden = !need;
  if (!need && !tokenDone) { tokenDone = true; enableNotifications().catch(() => { tokenDone = false; }); } // refresh this phone's token quietly
}
$("gateBtn").onclick = async () => {
  $("gateMsg").textContent = "";
  try { await enableNotifications(); }
  catch { $("gateMsg").textContent = Notification.permission === "denied" ? "Blocked. Chrome menu ⋮ > Site settings > Notifications > Allow, then tap again." : "Could not enable. Try again."; }
  checkGate();
};
$("gateOut").onclick = async () => { await signOut(auth); location.replace("login.html"); };
document.addEventListener("visibilitychange", () => !document.hidden && checkGate());
let installEvt; addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("installBtn").hidden = false; });
$("installBtn").onclick = async () => { installEvt?.prompt(); installEvt = null; $("installBtn").hidden = true; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js");
