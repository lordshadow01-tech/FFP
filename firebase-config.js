// Firebase setup. Paste your own web-app config from Firebase Console > Project settings.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCPtc4sztVuh4kI8zE-UW8LHT_TyGN9ujA",
  authDomain: "ff-payaluga-89ea7.firebaseapp.com",
  projectId: "ff-payaluga-89ea7",
  storageBucket: "ff-payaluga-89ea7.firebasestorage.app",
  messagingSenderId: "196806513326",
  appId: "1:196806513326:web:fc8765c25cdad8a693d33f"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
