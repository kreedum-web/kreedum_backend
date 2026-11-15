// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Brand = require("../src/models/Brand");
const { planLogos, run, slugOfFile } = require("../src/migration/brandLogos");

const brands = [
  { _id: "b1", name: "Aerofit", slug: "aerofit", logo: "" },
  { _id: "b2", name: "Vector X", slug: "vector-x", logo: "" },
  { _id: "b3", name: "Kreedum", slug: "kreedum", logo: "https://old/logo.png" },
  { _id: "b4", name: "Xpeed", slug: "xpeed", logo: "" },
  { _id: "b5", name: "Zorex Fitness", slug: "zorex-fitness", logo: "", isActive: false },
];

test("brand logos: files match brands by slug or name; others are reported", () => {
  assert.equal(slugOfFile("Vector X.PNG"), "vector-x");
  const plan = planLogos(brands, ["aerofit.png", "Vector X.svg", "kreedum.webp", "nike.png", "README.md"]);
  assert.deepEqual(plan.matches.map((m) => m.brand.slug).sort(), ["aerofit", "kreedum", "vector-x"]);
  assert.deepEqual(plan.unknownFiles, ["nike.png"]);
  // Xpeed has no file and no logo; Kreedum already has one; Zorex is hidden.
  assert.deepEqual(plan.withoutLogo.map((b) => b.slug), ["xpeed"]);
  assert.deepEqual(planLogos(brands, ["aerofit.png", "xpeed.png"], { only: "xpeed" }).matches.map((m) => m.brand.slug), ["xpeed"]);
});

test("brand logos: --apply uploads to kreedum/brands and saves the address on the brand", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logos-"));
  fs.writeFileSync(path.join(dir, "aerofit.png"), "x");
  fs.writeFileSync(path.join(dir, "kreedum.png"), "x");

  Brand.find = () => ({ sort: () => ({ lean: async () => brands.map((b) => ({ ...b })) }) });
  const updates = [];
  Brand.updateOne = async (filter, update) => (updates.push({ filter, update }), { matchedCount: 1 });
  const uploads = [];
  const upload = async (file, options) => {
    uploads.push({ file: path.basename(file), ...options });
    return { url: `https://res.cloudinary.com/x/image/upload/f_auto/kreedum/brands/${options.name}`, publicId: `kreedum/brands/${options.name}` };
  };

  const dry = await run({ apply: false, dir, upload });
  assert.equal(uploads.length, 0);
  assert.ok(dry.some((line) => /kreedum\.png.*Kreedum \(replaces its logo\)/.test(line)));

  await run({ apply: true, dir, upload });
  assert.deepEqual(uploads.map((u) => [u.file, u.kind, u.name, u.overwrite]), [
    ["aerofit.png", "brands", "aerofit", true],
    ["kreedum.png", "brands", "kreedum", true],
  ]);
  assert.deepEqual(updates[0], {
    filter: { _id: "b1" },
    update: { $set: { logo: "https://res.cloudinary.com/x/image/upload/f_auto/kreedum/brands/aerofit", logoPublicId: "kreedum/brands/aerofit" } },
  });
});
