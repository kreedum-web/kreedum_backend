const SearchLog = require("../models/SearchLog");
const SearchSetting = require("../models/SearchSetting");
const { normalize } = require("../utils/searchText");

/**
 * What customers search for: each new search is recorded (without who
 * searched), which gives the admin's Search page and the website's
 * "Popular searches".
 */

// Shown while there aren't enough real searches yet.
const STARTER_SEARCHES = [
  "Aerofit Treadmill",
  "Multi Gym",
  "Exercise Bike",
  "Commercial Treadmill",
  "Smith Machine",
  "Massage Chair",
  "Dumbbells",
  "Spin Bike",
];
const POPULAR_COUNT = 8;
const POPULAR_DAYS = 30;
const MIN_SEARCHES = 2; // a search must have been made at least twice to be "popular"

const termOf = (text) => normalize(text).slice(0, 100);

/**
 * Record a search. Only a new search counts: page 1 with no brand / price
 * filter and the default order (changing a filter re-runs the same search).
 * Never throws: search must work even if this fails.
 */
function recordSearch({ text, results, relaxed, page = 1, filtered = false }) {
  const term = termOf(text);
  if (!term || term.length < 2 || page !== 1 || filtered) return;
  SearchLog.create({ term, text: String(text).trim().slice(0, 100), results, relaxed: Boolean(relaxed) }).catch(() => {});
  popularCache = null;
}

async function settings() {
  return (await SearchSetting.findOne({ key: "search" }).lean()) || { pinned: [], hidden: [] };
}

/**
 * Searches over the last `days`:
 *   top:       most made, with their latest result count
 *   noResults: made but finding nothing (or nothing matching every word)
 */
async function searchStats({ days = 30, limit = 50 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const group = {
    _id: "$term",
    count: { $sum: 1 },
    text: { $last: "$text" },
    results: { $last: "$results" },
    relaxed: { $last: "$relaxed" },
    lastAt: { $max: "$at" },
  };
  const [top, noResults, totals] = await Promise.all([
    SearchLog.aggregate([{ $match: { at: { $gte: since } } }, { $sort: { at: 1 } }, { $group: group }, { $sort: { count: -1, lastAt: -1 } }, { $limit: limit }]),
    SearchLog.aggregate([
      { $match: { at: { $gte: since } } },
      { $sort: { at: 1 } },
      { $group: group },
      { $match: { $or: [{ results: 0 }, { relaxed: true }] } },
      { $sort: { count: -1, lastAt: -1 } },
      { $limit: limit },
    ]),
    SearchLog.aggregate([
      { $match: { at: { $gte: since } } },
      { $group: { _id: null, searches: { $sum: 1 }, empty: { $sum: { $cond: [{ $eq: ["$results", 0] }, 1, 0] } } } },
    ]),
  ]);
  const row = (r) => ({ term: r._id, text: r.text, count: r.count, results: r.results, relaxed: r.relaxed, lastAt: r.lastAt });
  return {
    days,
    searches: totals[0]?.searches || 0,
    withoutResults: totals[0]?.empty || 0,
    top: top.map(row),
    noResults: noResults.map(row),
  };
}

let popularCache = null; // { at, list }

/** "aerofit treadmill" → "Aerofit Treadmill" */
const titleCase = (text) => text.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * The website's popular searches: the admin's pinned ones, then the most
 * made searches that find products (last 30 days), then starter ones.
 */
async function popularSearches() {
  if (popularCache && Date.now() - popularCache.at < 10 * 60 * 1000) return popularCache.list;
  const { pinned = [], hidden = [] } = await settings();
  const hiddenTerms = new Set(hidden.map(termOf));
  const since = new Date(Date.now() - POPULAR_DAYS * 24 * 60 * 60 * 1000);
  const made = await SearchLog.aggregate([
    { $match: { at: { $gte: since }, results: { $gt: 0 }, relaxed: false } },
    { $group: { _id: "$term", count: { $sum: 1 } } },
    { $match: { count: { $gte: MIN_SEARCHES } } },
    { $sort: { count: -1 } },
    { $limit: 40 },
  ]).catch(() => []);

  const list = [];
  const seen = new Set();
  const add = (text) => {
    const term = termOf(text);
    if (!term || seen.has(term) || hiddenTerms.has(term) || list.length >= POPULAR_COUNT) return;
    seen.add(term);
    list.push(/[A-Z]/.test(text) ? text.trim() : titleCase(term));
  };
  pinned.forEach(add);
  made.forEach((m) => add(m._id));
  STARTER_SEARCHES.forEach(add);
  popularCache = { at: Date.now(), list };
  return list;
}

function clearPopularCache() {
  popularCache = null;
}

module.exports = { recordSearch, searchStats, popularSearches, clearPopularCache, settings, termOf, STARTER_SEARCHES };
