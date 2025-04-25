import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

const auth = getAuth();
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");
const signupTrigger = document.getElementById("signup-trigger");

// 🔐 Log In Handler
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value;
  const password = passwordInput.value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    alert("Login failed: " + err.message);
  }
});

// 🆕 Sign Up Trigger
signupTrigger.addEventListener("click", async (e) => {
  e.preventDefault();
  const email = emailInput.value;
  const password = passwordInput.value;
  
  if (!email || !password) {
    alert("Please enter an email and password first.");
    return;
  }

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("Account created and logged in!");
  } catch (err) {
    alert("Sign up failed: " + err.message);
  }
});

// 🚪 Log Out Button
logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  location.reload();
});

// 👁️ Update visibility based on login state
onAuthStateChanged(auth, (user) => {
  if (user) {
    logoutButton.classList.remove("hidden");
    loginForm.style.display = "none";
    signupTrigger.parentElement.style.display = "none";
  } else {
    logoutButton.classList.add("hidden");
    loginForm.style.display = "block";
    signupTrigger.parentElement.style.display = "block";
  }
});
