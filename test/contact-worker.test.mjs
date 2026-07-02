import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import worker, {
  validateContactSubmission,
} from "../src/contact-worker.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("validates a normal contact submission", () => {
  const result = validateContactSubmission({
    name: "Jane Visitor",
    email: "jane@example.com",
    message: "Hello from the contact form.",
    "cf-turnstile-response": "token",
    website: "",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.email, "jane@example.com");
});

test("rejects honeypot submissions", () => {
  const result = validateContactSubmission({
    name: "Bot",
    email: "bot@example.com",
    message: "Spam",
    "cf-turnstile-response": "token",
    website: "filled",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "honeypot");
});

test("rejects messages with too many links", () => {
  const result = validateContactSubmission({
    name: "Link Dropper",
    email: "links@example.com",
    message: "https://a.example https://b.example https://c.example https://d.example",
    "cf-turnstile-response": "token",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "links");
});

test("rejects non-POST requests", async () => {
  const response = await worker.fetch(
    new Request("https://umnhoj.com/api/contact"),
    {},
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
});

test("sends email after validation and Turnstile verification", async () => {
  const sentMessages = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    assert.equal(init.method, "POST");
    return Response.json({
      success: true,
      hostname: "umnhoj.com",
      action: "contact",
    });
  };

  const env = {
    TURNSTILE_SECRET_KEY: "secret",
    CONTACT_ALLOWED_HOSTNAMES: "umnhoj.com",
    CONTACT_EXPECTED_ACTION: "contact",
    CONTACT_DESTINATION_EMAIL: "destination@example.com",
    CONTACT_FROM_EMAIL: "noreply@johnmu.dev",
    CONTACT_FROM_NAME: "John Mu Contact Form",
    EMAIL: {
      async send(message) {
        sentMessages.push(message);
        return { messageId: "test-message" };
      },
    },
  };

  const response = await worker.fetch(
    new Request("https://umnhoj.com/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Jane Visitor",
        email: "jane@example.com",
        message: "Hello.",
        "cf-turnstile-response": "token",
        website: "",
      }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].from.email, "noreply@johnmu.dev");
  assert.equal(sentMessages[0].replyTo.email, "jane@example.com");
});
