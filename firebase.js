// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  writeBatch,
  increment,
  serverTimestamp,
  runTransaction,
  onSnapshot,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyApkVMpbaHkUEZU0H8tW3vzxaM2DYxPdwM",
  authDomain: "sranker-f2642.firebaseapp.com",
  projectId: "sranker-f2642",
  storageBucket: "sranker-f2642.appspot.com",
  messagingSenderId: "601665183803",
  appId: "1:601665183803:web:705a2ebeeb43b672ef3c1e",
  measurementId: "G-JTG8MVCW64"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// Auth helpers
export const signIn  = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const signUp  = (email, password) => createUserWithEmailAndPassword(auth, email, password);
export const signOut = () => firebaseSignOut(auth);
export const onAuth  = (cb) => onAuthStateChanged(auth, cb);

// Re-export Firestore functions
export {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  writeBatch,
  increment,
  serverTimestamp,
  runTransaction,
  onSnapshot,
  arrayUnion
};
