import { auth, db, collection, addDoc, serverTimestamp, onAuth, getDoc, doc } from "./firebase.js";

const THROTTLE_MS = 60000; // 60 seconds between requests

document.addEventListener("DOMContentLoaded", () => {
  const submitBtn = document.getElementById("request-submit-btn");
  const input = document.getElementById("request-input");
  const statusEl = document.getElementById("request-status");

  if (!submitBtn || !input || !statusEl) return;

  submitBtn.addEventListener("click", handleSubmit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });

  async function handleSubmit() {
    const text = input.value.trim();
    statusEl.classList.add("hidden");

    // Validate
    if (!text || text.length < 3) {
      showStatus("Please enter a movie title (at least 3 characters).", "error");
      return;
    }
    if (text.length > 100) {
      showStatus("Movie title is too long (max 100 characters).", "error");
      return;
    }

    // Check auth
    const user = auth.currentUser;
    if (!user) {
      showStatus("You must be logged in to submit a request.", "error");
      return;
    }

    // Throttle
    const lastRequest = localStorage.getItem("lastMovieRequest");
    if (lastRequest && Date.now() - parseInt(lastRequest, 10) < THROTTLE_MS) {
      const secsLeft = Math.ceil((THROTTLE_MS - (Date.now() - parseInt(lastRequest, 10))) / 1000);
      showStatus(`Please wait ${secsLeft} seconds before submitting another request.`, "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      // Fetch username
      let displayName = user.email;
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists() && userDoc.data().username) {
        displayName = userDoc.data().username;
      }

      await addDoc(collection(db, "movieRequests"), {
        requestText: text,
        normalizedText: text.toLowerCase().trim(),
        userId: user.uid,
        userDisplayName: displayName,
        status: "new",
        adminNotes: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      localStorage.setItem("lastMovieRequest", Date.now().toString());
      input.value = "";
      showStatus("Request submitted! We'll review it soon.", "success");
    } catch (err) {
      console.error("Movie request error:", err);
      showStatus("Something went wrong. Please try again.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Request";
    }
  }

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = "status-message";
    statusEl.classList.add(type === "success" ? "status-success" : "status-error");
    statusEl.classList.remove("hidden");
  }
});
