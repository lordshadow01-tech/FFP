// Cache-first app shell so the app opens offline. Bump VERSION on every release.
const VERSION = "ffp-v1.7";
const SHELL = ["./", "index.html", "login.html", "register.html", "dashboard.html", "dashboard.js", "style.css", "script.js",
  "manifest.json", "firebase-config.js", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];

// Push alarms from the server (works when the app is closed). Same worker, so offline cache keeps working.
try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
  firebase.initializeApp({ apiKey: "AIzaSyCPtc4sztVuh4kI8zE-UW8LHT_TyGN9ujA", authDomain: "ff-payaluga-89ea7.firebaseapp.com", projectId: "ff-payaluga-89ea7",
    messagingSenderId: "196806513326", appId: "1:196806513326:web:fc8765c25cdad8a693d33f" });
  firebase.messaging().onBackgroundMessage(p => self.registration.showNotification("⏰ " + p.data.title, {
    body: p.data.body, tag: p.data.alarmId, icon: "icon-192.png", vibrate: [500, 250, 500, 250, 500], requireInteraction: true, data: { url: "dashboard.html" } }));
} catch (err) { /* offline: caching still works */ }
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.includes("dashboard.html"));
    return w ? w.focus() : clients.openWindow("dashboard.html");
  }));
});

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Firebase calls go direct
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then(hit => hit || caches.match("index.html"))));
});
