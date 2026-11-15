// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const Enquiry = require("../src/models/Enquiry");
const User = require("../src/models/User");

const saved = [];
Enquiry.create = async (doc) => {
  const row = { _id: `e${saved.length + 1}`, createdAt: new Date(), ...doc };
  saved.push(row);
  return row;
};
const ACCOUNT = { _id: "64b000000000000000000001", email: "asha@gmail.com", phone: "" };
User.findById = async (id) => (String(id) === ACCOUNT._id ? ACCOUNT : null);

const { submitEnquiry, cleanEnquiry } = require("../src/services/enquiryService");
const rateLimit = require("../src/middleware/rateLimit");
const app = require("../src/app");

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
  message: "Need a quote for 20 machines.",
  ...extra,
});

function post(body, token) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const data = JSON.stringify(body);
      const req = http.request(
        {
          port: server.address().port,
          path: "/api/v1/enquiries",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(data),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        },
        (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode, body: JSON.parse(text) });
          });
        }
      );
      req.on("error", (error) => (server.close(), reject(error)));
      req.end(data);
    });
  });
}

test("enquiry from a visitor: saved with signedIn false", async () => {
  saved.length = 0;
  rateLimit.reset();
  const res = await post(form());
  assert.equal(res.status, 201);
  assert.equal(res.body.data.signedIn, false);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].signedIn, false);
  assert.equal(saved[0].user, null);
  assert.equal(saved[0].phone, "9876543210");
  assert.equal(saved[0].email, "ravi@school.in");
});

test("enquiry from a signed-in customer: saved with signedIn true and the account", async () => {
  saved.length = 0;
  rateLimit.reset();
  const token = jwt.sign({ id: ACCOUNT._id }, process.env.JWT_SECRET);
  const res = await post(form(), token);
  assert.equal(res.status, 201);
  assert.equal(saved[0].signedIn, true);
  assert.equal(String(saved[0].user), ACCOUNT._id);
  assert.equal(saved[0].accountLogin, "asha@gmail.com");
});

test("an expired or wrong token doesn't block the enquiry", async () => {
  saved.length = 0;
  rateLimit.reset();
  const res = await post(form(), "not-a-real-token");
  assert.equal(res.status, 201);
  assert.equal(saved[0].signedIn, false);
});

test("enquiry: a missing field → 400 with a message for that field", async () => {
  saved.length = 0;
  rateLimit.reset();
  const res = await post(form({ phone: "12345" }));
  assert.equal(res.status, 400);
  assert.match(res.body.errors.phone, /10-digit/);
  assert.equal(saved.length, 0);
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
  assert.ok(error(form({ name: "" })).extra.errors.name);
  assert.ok(error(form({ city: " " })).extra.errors.city);
  assert.ok(error(form({ email: "not-an-email" })).extra.errors.email);
  assert.ok(error(form({ equipmentNeed: "" })).extra.errors.equipmentNeed);
  assert.equal(cleanEnquiry(form({ budget: "<script>" })).budget, "Other");
  assert.equal(cleanEnquiry(form({ phone: "09876543210" })).phone, "9876543210");
});

test("enquiry: bots that fill the hidden field are ignored", async () => {
  saved.length = 0;
  const result = await submitEnquiry(form({ website: "http://spam.example" }));
  assert.equal(result.id, null);
  assert.equal(saved.length, 0);
});
