// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const { assetFolderFor } = require("../src/utils/cloudinaryFolders");
const { organize } = require("../src/migration/organizeImageFolders");

test("every Kreedum image belongs in its kind's Media Library folder", () => {
  assert.equal(assetFolderFor("kreedum/products/2025/09/af-404-treadmill"), "kreedum/products");
  assert.equal(assetFolderFor("kreedum/products/other/abc123"), "kreedum/products");
  assert.equal(assetFolderFor("kreedum/homepage/hero/aerofit-premium-gym-equipment"), "kreedum/homepage/hero");
  assert.equal(assetFolderFor("kreedum/leaders/richa-kothari"), "kreedum/leaders");
  assert.equal(assetFolderFor("kreedum/clients/hal"), "kreedum/clients");
  assert.equal(assetFolderFor("kreedum/misc/x"), "kreedum/misc");
});

/** Stand-in for cloudinary.api: pages of 2, optional hourly limit. */
function fakeApi(resources, { limitAfter = Infinity, remaining } = {}) {
  const updates = [];
  return {
    updates,
    async resources({ next_cursor: cursor }) {
      const start = Number(cursor || 0);
      const page = resources.slice(start, start + 2);
      return { resources: page, next_cursor: start + 2 < resources.length ? String(start + 2) : undefined };
    },
    async update(publicId, { asset_folder: folder }) {
      if (updates.length >= limitAfter) {
        // shape the Cloudinary package really rejects with
        throw { error: { message: "Rate Limit Exceeded", http_code: 420 } };
      }
      updates.push([publicId, folder]);
      resources.find((r) => r.public_id === publicId).asset_folder = folder;
      return { rate_limit_remaining: remaining === undefined ? 400 : remaining - updates.length };
    },
  };
}

const sample = () => [
  { public_id: "kreedum/products/2025/09/a", asset_folder: "" },
  { public_id: "kreedum/products/2025/09/b", asset_folder: "kreedum/products" },
  { public_id: "kreedum/products/2024/08/c", asset_folder: "" },
  { public_id: "kreedum/leaders/richa-kothari", asset_folder: "" },
  { public_id: "kreedum/clients/hal", asset_folder: "" },
];

test("dry run counts what needs moving and moves nothing", async () => {
  const api = fakeApi(sample());
  const result = await organize({ apply: false, api, log: () => {} });
  assert.deepEqual(result, { total: 5, misplaced: 4, moved: 0, left: 4, stoppedByLimit: false });
  assert.equal(api.updates.length, 0);
});

test("moves only misplaced images, across pages; a second run has nothing to do", async () => {
  const resources = sample();
  const api = fakeApi(resources);
  const result = await organize({ apply: true, api, log: () => {} });
  assert.equal(result.moved, 4);
  assert.deepEqual(api.updates, [
    ["kreedum/products/2025/09/a", "kreedum/products"],
    ["kreedum/products/2024/08/c", "kreedum/products"],
    ["kreedum/leaders/richa-kothari", "kreedum/leaders"],
    ["kreedum/clients/hal", "kreedum/clients"],
  ]);
  const again = await organize({ apply: true, api: fakeApi(resources), log: () => {} });
  assert.equal(again.misplaced, 0);
});

test("stops at the per-run cap and at Cloudinary's hourly limit, then continues next run", async () => {
  const resources = sample();
  const capped = await organize({ apply: true, limit: 2, api: fakeApi(resources), log: () => {} });
  assert.deepEqual([capped.moved, capped.left, capped.stoppedByLimit], [2, 2, false]);

  const limited = await organize({ apply: true, api: fakeApi(resources, { limitAfter: 1 }), log: () => {} });
  assert.deepEqual([limited.moved, limited.left, limited.stoppedByLimit], [1, 1, true]);

  const last = await organize({ apply: true, api: fakeApi(resources), log: () => {} });
  assert.deepEqual([last.moved, last.left], [1, 0]);
});

test("new uploads go straight into their folder", async () => {
  const { v2: cloudinary } = require("cloudinary");
  const calls = [];
  cloudinary.uploader.upload = async (source, options) => {
    calls.push(options);
    return { secure_url: `https://res.cloudinary.com/k/image/upload/v1/${options.public_id}.jpg`, public_id: options.public_id };
  };

  const { uploadImage } = require("../src/utils/cloudinaryFolders");
  await uploadImage("x.jpg", { kind: "leaders", name: "Richa Kothari" });
  assert.equal(calls[0].asset_folder, "kreedum/leaders");

  const { uploadOne } = require("../src/migration/uploadImages");
  await uploadOne("https://metrosports.co.in/wp-content/uploads/2025/09/a.png", "kreedum/products/2025/09/a");
  assert.equal(calls[1].asset_folder, "kreedum/products");
});

test("stops by itself when Cloudinary reports only a few requests left", async () => {
  const api = fakeApi(sample(), { remaining: 5 });
  const result = await organize({ apply: true, api, log: () => {} });
  assert.deepEqual([result.moved, result.stoppedByLimit], [2, true]); // 5-1=4, 5-2=3 -> stop
});

test("a repeated non-limit error stops the run instead of failing every image", async () => {
  const resources = Array.from({ length: 20 }, (_, i) => ({ public_id: `kreedum/products/2024/11/p${i}`, asset_folder: "" }));
  const api = fakeApi(resources);
  let calls = 0;
  api.update = async () => {
    calls++;
    throw { error: { message: "Something else", http_code: 500 } };
  };
  const lines = [];
  const result = await organize({ apply: true, api, log: (l) => lines.push(l) });
  assert.equal(calls, 5);
  assert.equal(result.moved, 0);
  assert.ok(lines.some((l) => /p0: Something else/.test(l)));
});
