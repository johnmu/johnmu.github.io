---
layout: page
title: Contact
permalink: /contact/
---

Send a note and I'll get back when I can.

<form id="contact-form" class="contact-form" method="post" action="/api/contact">
  <div class="contact-field">
    <label for="contact-name">Name</label>
    <input id="contact-name" name="name" type="text" autocomplete="name" maxlength="100" required>
  </div>

  <div class="contact-field">
    <label for="contact-email">Email</label>
    <input id="contact-email" name="email" type="email" autocomplete="email" maxlength="254" required>
  </div>

  <div class="contact-field">
    <label for="contact-message">Message</label>
    <textarea id="contact-message" name="message" rows="8" maxlength="5000" required></textarea>
  </div>

  <div class="contact-field contact-honeypot" aria-hidden="true">
    <label for="contact-website">Website</label>
    <input id="contact-website" name="website" type="text" tabindex="-1" autocomplete="off">
  </div>

  <div class="cf-turnstile" data-sitekey="0x4AAAAAADuk9igksBwtpRtR" data-action="contact" data-theme="auto"></div>

  <button class="contact-submit" type="submit">Send</button>
  <p id="contact-status" class="contact-status" role="status" aria-live="polite"></p>
</form>

<p class="contact-links">
  <a href="https://www.linkedin.com/in/johnchongmu">LinkedIn</a>
  <a href="https://twitter.com/jm1234567890">Twitter</a>
  <a href="https://github.com/johnmu">GitHub</a>
</p>

<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script>
  (function () {
    var form = document.getElementById("contact-form");
    var status = document.getElementById("contact-status");

    if (!form || !status) {
      return;
    }

    var submit = form.querySelector("button[type='submit']");

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      if (!form.reportValidity()) {
        return;
      }

      sendContactMessage();
    });

    async function sendContactMessage() {
      var data = new FormData(form);
      var payload = {
        name: String(data.get("name") || ""),
        email: String(data.get("email") || ""),
        message: String(data.get("message") || ""),
        website: String(data.get("website") || ""),
        "cf-turnstile-response": String(data.get("cf-turnstile-response") || "")
      };

      setStatus("Sending...", true, "");

      try {
        var response = await fetch(form.action, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "accept": "application/json",
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        var result = await response.json().catch(function () {
          return {};
        });

        if (!response.ok || !result.ok) {
          throw new Error(result.message || "Please check the form and try again.");
        }

        form.reset();
        resetTurnstile();
        setStatus(result.message || "Thanks, your message was sent.", false, "success");
      } catch (error) {
        resetTurnstile();
        setStatus(error.message || "Sorry, something went wrong. Please try again later.", false, "error");
      }
    }

    function resetTurnstile() {
      if (window.turnstile) {
        window.turnstile.reset();
      }
    }

    function setStatus(message, disabled, state) {
      if (submit) {
        submit.disabled = disabled;
      }
      status.textContent = message;
      status.dataset.state = state;
    }
  }());
</script>

<style>
  .contact-form {
    max-width: 40rem;
    margin: 1.5rem 0;
  }

  .contact-field {
    margin-bottom: 1rem;
  }

  .contact-field label {
    display: block;
    margin-bottom: 0.35rem;
    font-weight: 600;
  }

  .contact-field input,
  .contact-field textarea {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid #c9c9c9;
    border-radius: 4px;
    padding: 0.65rem 0.7rem;
    font: inherit;
  }

  .contact-field textarea {
    resize: vertical;
  }

  .contact-honeypot {
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }

  .contact-submit {
    margin-top: 1rem;
    border: 1px solid #1f2937;
    border-radius: 4px;
    background: #1f2937;
    color: #ffffff;
    cursor: pointer;
    font: inherit;
    padding: 0.65rem 1rem;
  }

  .contact-submit:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  .contact-status {
    min-height: 1.5rem;
    margin-top: 1rem;
  }

  .contact-status[data-state="success"] {
    color: #0f6b3f;
  }

  .contact-status[data-state="error"] {
    color: #9f1239;
  }

  .contact-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
</style>
