/**
 * Turning what customers type into search words: any capitals, any word
 * order, symbols and dashes ignored, plurals, common spellings, and price
 * phrases such as "under 1 lakh", "below 50k", "10000 to 20000".
 * No database here (tested on its own).
 */

// Words that don't help find a product.
const STOP_WORDS = new Set([
  "a", "an", "the", "for", "with", "and", "of", "in", "on", "to", "at", "by", "or",
  "best", "buy", "online", "price", "prices", "cheap", "cheapest", "good", "top", "latest",
  "show", "me", "i", "want", "need", "looking", "please", "my", "some", "any",
  "rs", "inr", "rupees", "rupee",
]);

// Other ways people write the same thing → words our products use (any one counts).
const SYNONYMS = {
  cycle: ["bike"],
  cycles: ["bike"],
  bicycle: ["bike"],
  spinning: ["spin"],
  dumbell: ["dumbbell"],
  dumbel: ["dumbbell"],
  dumbells: ["dumbbell"],
  multigym: ["multi", "gym"],
  homegym: ["home", "gym"],
  crosstrainer: ["cross", "trainer"],
  elliptical: ["cross"],
  treadmil: ["treadmill"],
  thredmill: ["treadmill"],
  massager: ["massager", "massage"],
  yogamat: ["yoga", "mat"],
  pushup: ["push", "up"],
  situp: ["sit", "up"],
  kettle: ["kettlebell"],
};

/** Lowercase, no accents, symbols and dashes as spaces. */
function normalize(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "gloves" → "glove", "benches" → "bench", "dumbbells" → "dumbbell". Numbers and short words stay. */
function stem(word) {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

/** Words of a text (normalised, stemmed), plus joined forms of model numbers: "af-380tr" → af, 380tr, af380tr. */
function termsOf(text) {
  const raw = String(text ?? "");
  const words = normalize(raw).split(" ").filter(Boolean).map(stem);
  const joined = (raw.toLowerCase().match(/[a-z0-9]+(?:[-/][a-z0-9]+)+/g) || []).map((code) => code.replace(/[-/]/g, ""));
  return [...words, ...joined];
}

// ------------------------------------------------------------------ prices

const AMOUNT = String.raw`(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|cr|crore)?\b`;

function amount(number, unit = "") {
  let value = Number(String(number).replace(/,/g, ""));
  const u = unit.toLowerCase();
  if (u === "k" || u === "thousand") value *= 1000;
  else if (/^(lakhs?|lacs?|l)$/.test(u)) value *= 100000;
  else if (u === "cr" || u === "crore") value *= 10000000;
  return Math.round(value);
}

/**
 * Price phrases in a search, and the search without them.
 * @returns {{ text: string, minPrice?: number, maxPrice?: number }}
 */
function parsePrice(query) {
  let text = String(query ?? "").toLowerCase();
  let minPrice;
  let maxPrice;

  const take = (pattern, use) => {
    const match = text.match(pattern);
    if (!match) return false;
    use(match);
    text = text.replace(match[0], " ");
    return true;
  };

  // between 10000 and 20000 / 10k to 20k / 10000-20000 / from 10000 to 20000
  take(new RegExp(String.raw`(?:between|from)?\s*${AMOUNT}\s*(?:and|to|-|–)\s*${AMOUNT}`, "i"), (m) => {
    const a = amount(m[1], m[2] || m[4]);
    const b = amount(m[3], m[4]);
    // "between 10 and 20k": both in thousands
    if (a && b && a < 1000 && b >= 1000 && !m[2] && m[4]) {
      minPrice = amount(m[1], m[4]);
      maxPrice = b;
    } else {
      minPrice = Math.min(a, b);
      maxPrice = Math.max(a, b);
    }
  }) ||
    take(new RegExp(String.raw`(?:under|below|less than|lower than|upto|up to|within|max(?:imum)?|budget|<=?)\s*${AMOUNT}`, "i"), (m) => {
      maxPrice = amount(m[1], m[2]);
    });

  take(new RegExp(String.raw`(?:above|over|more than|greater than|starting(?: from)?|min(?:imum)?|>=?)\s*${AMOUNT}`, "i"), (m) => {
    minPrice = amount(m[1], m[2]);
  });

  // A bare amount with ₹ / rs: "treadmill ₹50000" → up to that price.
  if (maxPrice === undefined && minPrice === undefined) {
    take(/(?:₹|rs\.?|inr)\s*(\d[\d,]*)\s*(k|lakhs?|lacs?)?\b/i, (m) => {
      maxPrice = amount(m[1], m[2]);
    });
  }

  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];
  return { text: text.replace(/\s+/g, " ").trim(), minPrice, maxPrice };
}

/**
 * A customer's search, ready to match.
 * @returns {{ words: string[][], minPrice?, maxPrice?, text }}
 *   words: one entry per typed word, each a list of forms that count as that word
 */
function parseQuery(query) {
  const { text, minPrice, maxPrice } = parsePrice(String(query ?? "").slice(0, 200));
  const words = [];
  for (const word of normalize(text).split(" ")) {
    if (!word || STOP_WORDS.has(word)) continue;
    const forms = new Set([stem(word)]);
    for (const alt of SYNONYMS[word] || SYNONYMS[stem(word)] || []) forms.add(stem(alt));
    words.push([...forms]);
  }
  return { words: dedupe(words), minPrice, maxPrice, text };
}

function dedupe(words) {
  const seen = new Set();
  return words.filter((forms) => {
    const key = forms.join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ------------------------------------------------------------------ typos

/** Edit distance with swapped letters counted as one ("traedmill" → "treadmill" = 1). Stops early past `max`. */
function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = [];
  for (let i = 0; i <= a.length; i++) {
    rows[i] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        rows[i][j] = j;
        continue;
      }
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
      rows[i][j] = value;
      best = Math.min(best, value);
    }
    if (i > 0 && best > max) return max + 1;
  }
  return rows[a.length][b.length];
}

/** Typos allowed for a word of this length. */
const typosAllowed = (word) => (/\d/.test(word) ? 0 : word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0);

/**
 * How well a typed word matches a word in our catalogue:
 * 3 exact, 2 start of the word ("tread" → treadmill), 1 typo, 0 no.
 */
function wordMatch(typed, term) {
  if (typed === term) return 3;
  if (typed.length >= 2 && term.startsWith(typed)) return typed.length >= 3 || /\d/.test(typed) ? 2 : 1.5;
  const allowed = typosAllowed(typed);
  if (allowed && term.length >= 4 && editDistance(typed, term, allowed) <= allowed) return 1;
  return 0;
}

module.exports = { normalize, stem, termsOf, parsePrice, parseQuery, editDistance, wordMatch, STOP_WORDS };
