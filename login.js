// login.js
import { signIn, signUp } from "./firebase.js";

const form = document.getElementById("login-form");
const loginButton = document.getElementById("login-button");
const signupTrigger = document.getElementById("signup-trigger");
const loginHeading = document.getElementById("login-heading");
let isSignUp = false;

// Toggle between Login and Sign‑Up modes
signupTrigger.addEventListener("click", (e) => {
  e.preventDefault();
  isSignUp = !isSignUp;
  if (isSignUp) {
    loginButton.textContent = "Create Account";
    loginHeading.textContent = "Create Your Account";
    signupTrigger.textContent = "Already have an account? Log In";
  } else {
    loginButton.textContent = "Log In";
    loginHeading.textContent = "Create or Log In to Your Account";
    signupTrigger.textContent = "Don’t have an account? Create one";
  }
});

// Handle form submit for both flows
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = form.email.value.trim();
  const password = form.password.value.trim();
  try {
    if (isSignUp) {
      await signUp(email, password);
    } else {
      await signIn(email, password);
    }
    // after auth, page will update via onAuthStateChanged
  } catch (err) {
    alert((isSignUp ? "Sign-up" : "Login") + " failed: " + err.message);
    console.error(err);
  }
});
