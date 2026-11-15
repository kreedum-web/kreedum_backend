// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const { setTestTransport } = require("../src/utils/mailer");
const Enquiry = require("../src/models/Enquiry");

const saved = [];
Enquiry.create = async (doc) => {
  const row = { _id: `e${saved.length + 1}`, createdAt: new Date("2026-11-15T10:00:00Z"), ...doc };
  saved.push(row);
  return row;
};
Enquiry.updateOne = async (filter, update) => {
  const row = saved.find((r) => r._id === filter._id);
  if (row) Object.assign(row, update.$set);
  return { matchedCount: row ? 1 : 0 };
};

const mailbox = [];
setTestTransport({ sendMail: async (message) => (mailbox.push(message), { messageId: "m" }) });

const { submitEnquiry, cleanEnquiry, recipients } = require("../src/services/enquiryService");

const form = (extra = {}) => ({
  name: "Ravi Kumar",
  phone: "+91 98765 43210",
  email: "Ravi@School.in",
  city: "Lucknow",
  organisation: "City Montessori School",
  facilityType: "School / College",
  equipmentNeed: "Full gym setup",
  budget: "₹5 – 10 lakh",
  timeline: "1 – 3 months",
  message: "Need a quote for 20 machines.\nDelivery to Gomti Nagar.",
  ...extra,
});

test("enquiry: saved, emailed to the team (reply goes to the customer) and confirmed to the customer", async () => {
  saved.length = 0;
  mailbox.length = 0;
  process.env.ENQUIRY_EMAIL = "sales@kreedum.test, owner@kreedum.test";
  const result = await submitEnquiry(form(), { ip: "1.2.3.4" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(saved.length, 1);
  assert.equal(saved[0].phone, "9876543210");
  assert.equal(saved[0].email, "ravi@school.in");
  assert.equal(saved[0].ip, "1.2.3.4");
  assert.equal(saved[0].emailSent, true);
  assert.equal(result.emailSent, true);

  const team = mailbox.find((m) => m.to === "sales@kreedum.test, owner@kreedum.test");
  assert.ok(team, "team email");
  assert.equal(team.replyTo, "ravi@school.in");
  assert.match(team.subject, /Bulk enquiry: Ravi Kumar, Lucknow \(Full gym setup\)/);
  assert.match(team.text, /Mobile: \+91 9876543210/);
  assert.match(team.text, /City Montessori School/);
  assert.match(team.html, /wa\.me\/919876543210/);
  assert.match(team.html, /Need a quote for 20 machines\./);

  const customer = mailbox.find((m) => m.to === "ravi@school.in");
  assert.ok(customer, "confirmation email");
  assert.match(customer.text, /Hi Ravi,/);
  delete process.env.ENQUIRY_EMAIL;
});

test("enquiry: no email address → only the team email; default recipient", async () => {
  saved.length = 0;
  mailbox.length = 0;
  await submitEnquiry(form({ email: "" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mailbox.length, 1);
  assert.equal(mailbox[0].to, recipients({}));
  assert.equal(mailbox[0].replyTo, undefined);
});

test("enquiry: checks the fields", () => {
  const error = (body) => {
    try {
      cleanEnquiry(body);
      return null;
    } catch (e) {
      return e;
    }
  };
  assert.equal(error(form({ phone: "12345" })).status, 400);
  assert.match(error(form({ phone: "12345" })).message, /10-digit/);
  assert.ok(error(form({ name: "" })).extra.errors.name);
  assert.ok(error(form({ city: " " })).extra.errors.city);
  assert.ok(error(form({ email: "not-an-email" })).extra.errors.email);
  assert.ok(error(form({ equipmentNeed: "" })).extra.errors.equipmentNeed);
  // unknown choice → "Other" (the email stays tidy)
  assert.equal(cleanEnquiry(form({ budget: "<script>" })).budget, "Other");
  assert.equal(cleanEnquiry(form({ phone: "09876543210" })).phone, "9876543210");
});

test("enquiry: bots that fill the hidden field are ignored", async () => {
  saved.length = 0;
  mailbox.length = 0;
  const result = await submitEnquiry(form({ website: "http://spam.example" }));
  assert.equal(result.id, null);
  assert.equal(saved.length, 0);
  assert.equal(mailbox.length, 0);
});
