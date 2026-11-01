// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { fileName, deliveryUrl, checkCloudinaryUrl, uploadImage } = require("../src/utils/cloudinaryFolders");

// ---------------------------------------------------------------- stubs
/** Minimal in-memory stand-in for a Mongoose model. */
function fakeModel(Model, rows = []) {
  Model.__rows = rows;
  Model.countDocuments = async () => Model.__rows.length;
  Model.insertMany = async (docs) => Model.__rows.push(...docs.map((d, i) => ({ _id: `id${Model.__rows.length + i}`, ...d })));
  Model.find = (query) => ({
    sort: () => ({
      lean: async () =>
        Model.__rows
          .filter((r) => r.isActive)
          .filter((r) => !query.$and || ((!r.startsAt || r.startsAt <= new Date()) && (!r.endsAt || r.endsAt >= new Date())))
          .sort((a, b) => a.displayOrder - b.displayOrder),
    }),
  });
  return Model;
}

const HeroBanner = fakeModel(require("../src/models/HeroBanner"));
const Announcement = fakeModel(require("../src/models/Announcement"));
const Leader = fakeModel(require("../src/models/Leader"));
const Client = fakeModel(require("../src/models/Client"));
const reset = () => [HeroBanner, Announcement, Leader, Client].forEach((m) => (m.__rows = []));

// ---------------------------------------------------------------- folders

test("each kind of image has its own folder and delivery size", async () => {
  const { v2: cloudinary } = require("cloudinary");
  const calls = [];
  cloudinary.uploader.upload = async (source, options) => {
    calls.push(options);
    return { secure_url: `https://res.cloudinary.com/kreedum/image/upload/v1/${options.public_id}.jpg`, public_id: options.public_id };
  };

  const hero = await uploadImage("x.jpg", { kind: "hero", name: "Aerofit Premium Gym Equipment" });
  assert.equal(calls[0].public_id, "kreedum/homepage/hero/aerofit-premium-gym-equipment");
  assert.equal(calls[0].transformation[0].width, 2400);
  assert.match(hero.url, /\/upload\/f_auto,q_auto,c_limit,w_1920\/v1\/kreedum\/homepage\/hero\//);

  const leader = await uploadImage("x.jpg", { kind: "leaders", name: "Richa Kothari" });
  assert.equal(leader.publicId, "kreedum/leaders/richa-kothari");
  assert.match(leader.url, /w_800/);

  const client = await uploadImage("x.png", { kind: "clients", name: "Integral University, Lucknow" });
  assert.equal(client.publicId, "kreedum/clients/integral-university-lucknow");
  assert.match(client.url, /w_400/);

  await assert.rejects(uploadImage("x", { kind: "nope", name: "a" }), /Unknown image kind/);
  assert.equal(fileName("IIT KANPUR.png"), "iit-kanpur");
  assert.equal(deliveryUrl(hero.url, "hero"), hero.url); // not added twice
});

test("a wrong CLOUDINARY_URL is caught before anything is uploaded", () => {
  assert.throws(() => checkCloudinaryUrl(""), /missing/);
  assert.throws(() => checkCloudinaryUrl("cloudinary://<your_api_key>:<your_api_secret>@bmwsom9q"), /placeholders/);
  assert.throws(() => checkCloudinaryUrl('"cloudinary://1:s@x"'), /should look like/);
  assert.doesNotThrow(() => checkCloudinaryUrl("cloudinary://242815366312951:abcDEF_12-x@bmwsom9q"));
});

// ---------------------------------------------------------------- seeding

function imagesFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kreedum-images-"));
  const defaults = require("../src/data/defaultSiteContent");
  for (const item of [...defaults.heroBanners, ...defaults.leaders, ...defaults.clients]) {
    fs.mkdirSync(path.dirname(path.join(dir, item.file)), { recursive: true });
    fs.writeFileSync(path.join(dir, item.file), "img");
  }
  return dir;
}

test("seeding: dry run writes nothing; apply fills every section; running again changes nothing", async () => {
  reset();
  const { seed } = require("../src/migration/seedSiteContent");
  const imagesDir = imagesFolder();
  const uploads = [];
  const upload = async (file, { kind, name }) => {
    uploads.push([kind, path.basename(file)]);
    return { url: `https://res.cloudinary.com/k/${kind}/${name}`, publicId: `${kind}/${name}` };
  };

  const dry = await seed({ apply: false, imagesDir, upload });
  assert.equal(uploads.length, 0);
  assert.equal(HeroBanner.__rows.length, 0);
  assert.match(dry[0], /would add 3 → Cloudinary kreedum\/homepage\/hero/);

  await seed({ apply: true, imagesDir, upload });
  assert.equal(uploads.length, 3 + 2 + 16);
  assert.equal(HeroBanner.__rows.length, 3);
  assert.equal(Announcement.__rows.length, 3);
  assert.equal(Leader.__rows.length, 2);
  assert.equal(Client.__rows.length, 16);
  assert.deepEqual(
    { ...HeroBanner.__rows[0], _id: undefined },
    {
      _id: undefined,
      title: "Aerofit Premium Gym Equipment",
      subtitle: "Official Aerofit Channel Partner in Lucknow",
      buttonText: "Shop Aerofit",
      buttonLink: "/brands/aerofit",
      image: "https://res.cloudinary.com/k/hero/Aerofit Premium Gym Equipment",
      imagePublicId: "hero/Aerofit Premium Gym Equipment",
      displayOrder: 0,
      isActive: true,
    }
  );

  const again = await seed({ apply: true, imagesDir, upload });
  assert.equal(uploads.length, 21);
  assert.ok(again.every((line) => /already set up/.test(line)));
});

test("seeding stops a section when one of its images is missing", async () => {
  reset();
  const { seed } = require("../src/migration/seedSiteContent");
  const imagesDir = imagesFolder();
  fs.unlinkSync(path.join(imagesDir, "shivam-gupta.jpeg"));
  const upload = async (file, { kind, name }) => ({ url: `u/${name}`, publicId: name });
  const summary = await seed({ apply: true, imagesDir, upload });
  assert.equal(Leader.__rows.length, 0);
  assert.match(summary.find((l) => l.startsWith("Leaders")), /not found.*shivam-gupta\.jpeg/);
  assert.equal(Client.__rows.length, 16);
});

// ---------------------------------------------------------------- API

test("API: nothing set up yet -> built-in banners and null sections", async () => {
  reset();
  const service = require("../src/services/siteContentService");
  const banners = await service.getHeroBanners();
  assert.equal(banners.length, 3);
  assert.equal(banners[0].title, "Aerofit Premium Gym Equipment");
  assert.equal(banners[0].image, "");
  assert.deepEqual(await service.getSiteContent(), { announcements: null, leaders: null, clients: null });
});

test("API: only active content, in order, offers only between their dates", async () => {
  reset();
  const day = 24 * 3600 * 1000;
  HeroBanner.__rows = [
    { _id: "b2", title: "Second", displayOrder: 2, isActive: true },
    { _id: "b1", title: "First", displayOrder: 1, isActive: true, image: "https://res.cloudinary.com/x.jpg" },
    { _id: "off", title: "Hidden", displayOrder: 0, isActive: false },
    { _id: "old", title: "Expired offer", displayOrder: 0, isActive: true, endsAt: new Date(Date.now() - day) },
    { _id: "soon", title: "Future offer", displayOrder: 0, isActive: true, startsAt: new Date(Date.now() + day) },
  ];
  Announcement.__rows = [{ _id: "a1", text: "Diwali sale", link: "/categories/cardio", displayOrder: 0, isActive: false }];

  const service = require("../src/services/siteContentService");
  assert.deepEqual((await service.getHeroBanners()).map((b) => b.title), ["First", "Second"]);
  const content = await service.getSiteContent();
  assert.deepEqual(content.announcements, []); // set up, but all switched off -> show none
  assert.equal(content.leaders, null);
});
