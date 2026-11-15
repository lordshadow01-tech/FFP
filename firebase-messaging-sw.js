// Shows the alarm notification when the app is minimised or closed.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({"apiKey": "AIzaSyCPtc4sztVuh4kI8zE-UW8LHT_TyGN9ujA", "authDomain": "ff-payaluga-89ea7.firebaseapp.com", "projectId": "ff-payaluga-89ea7", "storageBucket": "ff-payaluga-89ea7.firebasestorage.app", "messagingSenderId": "196806513326", "appId": "1:196806513326:web:fc8765c25cdad8a693d33f"});
firebase.messaging().onBackgroundMessage(p => self.registration.showNotification("⏰ " + p.data.title, {
  body: p.data.body, tag: p.data.alarmId, icon: "icon.svg", vibrate: [400, 200, 400, 200, 400], requireInteraction: true }));
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(clients.openWindow("dashboard.html")); });
