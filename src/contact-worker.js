const MAX_BODY_BYTES = 32 * 1024;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_TURNSTILE_TOKEN_LENGTH = 2048;
const MAX_LINKS = 3;

const SUCCESS_MESSAGE = "Thanks, your message was sent.";
const VALIDATION_MESSAGE = "Please check the form and try again.";
const ERROR_MESSAGE = "Sorry, something went wrong. Please try again later.";
const RATE_LIMIT_MESSAGE = "Please wait a moment before trying again.";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/api/contact") {
      return jsonResponse({ ok: false, message: ERROR_MESSAGE }, 404);
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { ok: false, message: ERROR_MESSAGE },
        405,
        { Allow: "POST" },
      );
    }

    const rateLimitResponse = await enforceRateLimit(request, env);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const parsed = await parseContactRequest(request);
    if (!parsed.ok) {
      return jsonResponse({ ok: false, message: VALIDATION_MESSAGE }, parsed.status);
    }

    const submission = validateContactSubmission(parsed.fields);
    if (!submission.ok) {
      return jsonResponse({ ok: false, message: VALIDATION_MESSAGE }, 400);
    }

    const turnstile = await verifyTurnstile(
      submission.value.turnstileToken,
      request,
      env,
    );
    if (!turnstile.ok) {
      console.warn("turnstile verification failed", turnstile.reason);
      return jsonResponse({ ok: false, message: VALIDATION_MESSAGE }, 400);
    }

    try {
      await sendContactEmail(submission.value, env);
      return jsonResponse({ ok: true, message: SUCCESS_MESSAGE }, 200);
    } catch (error) {
      console.error("contact email send failed", {
        code: error?.code,
        name: error?.name,
      });
      return jsonResponse({ ok: false, message: ERROR_MESSAGE }, 500);
    }
  },
};

export async function parseContactRequest(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413 };
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() || "";

  try {
    if (contentType.includes("application/json")) {
      const fields = await request.json();
      return { ok: true, fields };
    }

    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await request.formData();
      return { ok: true, fields: formToObject(form) };
    }
  } catch {
    return { ok: false, status: 400 };
  }

  return { ok: false, status: 415 };
}

export function validateContactSubmission(fields) {
  const honeypot = getString(fields, ["website", "company", "_contact_website"]);
  if (honeypot.trim() !== "") {
    return { ok: false, reason: "honeypot" };
  }

  const name = normalizeSingleLine(getString(fields, ["name"]));
  const email = normalizeSingleLine(getString(fields, ["email"])).toLowerCase();
  const message = normalizeMessage(getString(fields, ["message"]));
  const turnstileToken = getString(fields, [
    "cf-turnstile-response",
    "turnstileToken",
    "turnstile_token",
  ]).trim();

  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: "name" };
  }

  if (
    email.length < 3 ||
    email.length > MAX_EMAIL_LENGTH ||
    !isLikelyEmail(email)
  ) {
    return { ok: false, reason: "email" };
  }

  if (message.length < 1 || message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, reason: "message" };
  }

  if (countLinks(message) > MAX_LINKS) {
    return { ok: false, reason: "links" };
  }

  if (
    turnstileToken.length < 1 ||
    turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH
  ) {
    return { ok: false, reason: "turnstile-token" };
  }

  return {
    ok: true,
    value: {
      name,
      email,
      message,
      turnstileToken,
    },
  };
}

export async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { ok: false, reason: "missing-secret" };
  }

  const formData = new FormData();
  formData.append("secret", env.TURNSTILE_SECRET_KEY);
  formData.append("response", token);
  formData.append("idempotency_key", crypto.randomUUID());

  const remoteIp = request.headers.get("cf-connecting-ip");
  if (remoteIp) {
    formData.append("remoteip", remoteIp);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData,
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return { ok: false, reason: "siteverify-http" };
    }

    const result = await response.json();
    if (!result.success) {
      return { ok: false, reason: "siteverify-rejected" };
    }

    if (
      env.CONTACT_ALLOWED_HOSTNAMES &&
      !isAllowedHostname(result.hostname, env.CONTACT_ALLOWED_HOSTNAMES)
    ) {
      return { ok: false, reason: "hostname" };
    }

    if (
      env.CONTACT_EXPECTED_ACTION &&
      result.action !== env.CONTACT_EXPECTED_ACTION
    ) {
      return { ok: false, reason: "action" };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.name || "siteverify-error" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendContactEmail(submission, env) {
  if (!env.EMAIL || typeof env.EMAIL.send !== "function") {
    throw new Error("Email binding is not configured");
  }

  const to = env.CONTACT_DESTINATION_EMAIL;
  const fromEmail = env.CONTACT_FROM_EMAIL;
  const fromName = env.CONTACT_FROM_NAME || "Contact Form";

  if (!to || !fromEmail) {
    throw new Error("Email addresses are not configured");
  }

  return env.EMAIL.send({
    to,
    from: {
      email: fromEmail,
      name: fromName,
    },
    replyTo: {
      email: submission.email,
      name: submission.name,
    },
    subject: `Contact form: ${submission.name.slice(0, 60)}`,
    text: buildTextEmail(submission),
    html: buildHtmlEmail(submission),
  });
}

async function enforceRateLimit(request, env) {
  if (
    !env.CONTACT_FORM_RATE_LIMITER ||
    typeof env.CONTACT_FORM_RATE_LIMITER.limit !== "function"
  ) {
    return null;
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const { success } = await env.CONTACT_FORM_RATE_LIMITER.limit({
    key: `contact:${ip}`,
  });

  if (success) {
    return null;
  }

  return jsonResponse({ ok: false, message: RATE_LIMIT_MESSAGE }, 429);
}

function formToObject(form) {
  const object = {};
  for (const [key, value] of form.entries()) {
    object[key] = typeof value === "string" ? value : "";
  }
  return object;
}

function getString(fields, names) {
  if (!fields || typeof fields !== "object") {
    return "";
  }

  for (const name of names) {
    const value = fields[name];
    if (typeof value === "string") {
      return value;
    }
  }

  return "";
}

function normalizeSingleLine(value) {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMessage(value) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "")
    .trim();
}

function isLikelyEmail(email) {
  if (/\s/.test(email) || email.includes("..")) {
    return false;
  }

  const parts = email.split("@");
  if (parts.length !== 2) {
    return false;
  }

  const [local, domain] = parts;
  if (!local || !domain || local.length > 64 || domain.length > 253) {
    return false;
  }

  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) {
    return false;
  }

  const labels = domain.split(".");
  if (labels.length < 2) {
    return false;
  }

  return labels.every((label) => {
    return (
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9-]+$/i.test(label) &&
      !label.startsWith("-") &&
      !label.endsWith("-")
    );
  });
}

function countLinks(message) {
  const matches = message.match(
    /\b(?:https?:\/\/|www\.)[^\s<>"']+|\[[^\]]+\]\([^)]+\)/gi,
  );
  return matches ? matches.length : 0;
}

function isAllowedHostname(hostname, allowedHostnames) {
  if (!hostname) {
    return false;
  }

  return allowedHostnames
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(hostname.toLowerCase());
}

function buildTextEmail(submission) {
  return [
    "New contact form submission",
    "",
    `Name: ${submission.name}`,
    `Email: ${submission.email}`,
    "",
    "Message:",
    submission.message,
  ].join("\n");
}

function buildHtmlEmail(submission) {
  return [
    "<p>New contact form submission</p>",
    "<dl>",
    `<dt>Name</dt><dd>${escapeHtml(submission.name)}</dd>`,
    `<dt>Email</dt><dd>${escapeHtml(submission.email)}</dd>`,
    "</dl>",
    "<p>Message:</p>",
    `<pre style=\"white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\">${escapeHtml(submission.message)}</pre>`,
  ].join("");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}
