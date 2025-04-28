// login.js
import { signIn, signUp, onAuth, signOut } from './firebase.js';

const form          = document.getElementById("login-form");
const loginButton   = document.getElementById("login-button");
const loginHeading  = document.getElementById("login-heading");
const signupTrigger = document.getElementById("signup-trigger");
const logoutButton  = document.getElementById('logout-button');
const emailInput    = document.getElementById('email');
const passwordInput = document.getElementById('password');
const statusMsg     = document.getElementById('login-status');

// Autofocus email field on page load
window.addEventListener('DOMContentLoaded', () => {
  emailInput.focus();
});

// Immediate signup when clicking "Create one"
signupTrigger.addEventListener("click", async (e) => {
  e.preventDefault();
  
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  
  if (!email || !password) {
    statusMsg.textContent = "Please enter your email and password first.";
    statusMsg.classList.remove('hidden');
    return;
  }

  try {
    await signUp(email, password);
    statusMsg.textContent = "Account created successfully! You are now logged in.";
    statusMsg.classList.remove('hidden');
  } catch (err) {
    console.error('Signup failed', err);
    statusMsg.textContent = "Signup failed: " + err.message;
    statusMsg.classList.remove('hidden');
  }
});

// Normal login on form submit
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  try {
    await signIn(email, password);
    statusMsg.textContent = "Logged in successfully!";
    statusMsg.classList.remove('hidden');
  } catch (err) {
    console.error('Login failed', err);
    statusMsg.textContent = "Login failed: " + err.message;
    statusMsg.classList.remove('hidden');
  }
});

// Update UI on auth changes
onAuth((user) => {
  if (user) {
    loginHeading.textContent = `Welcome Back, ${user.email}`;
    form.classList.add('hidden');
    signupTrigger.classList.add('hidden');
    logoutButton.classList.remove('hidden');
    statusMsg.textContent = "You are logged in.";
    statusMsg.classList.remove('hidden');
  } else {
    loginHeading.textContent = 'Create or Log In to Your Account';
    form.classList.remove('hidden');
    signupTrigger.classList.remove('hidden');
    logoutButton.classList.add('hidden');
    statusMsg.classList.add('hidden');
  }
});

// Logout button
logoutButton.addEventListener('click', async () => {
  try {
    await signOut();
  } catch (err) {
    console.error('Logout failed', err);
    alert('Logout failed: ' + err.message);
  }
});
