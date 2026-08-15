#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const STAR_HISTORY_PATH = path.join(ASSETS_DIR, 'star-history.json');
const STAR_SVG_PATH = path.join(ASSETS_DIR, 'star-history.svg');
const COMMIT_SVG_PATH = path.join(ASSETS_DIR, 'commit-activity.svg');
const REPOSITORY = 'u7-u7/dsh-desktop';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ACTIVITY_DAYS = 7;
const ACTIVITY_BUCKET_HOURS = 2;
const BEIJING_OFFSET_MS = 8 * HOUR_MS;
const COMMIT_COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[character]));
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function dateFromKey(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function readStarHistory() {
  try {
    const data = JSON.parse(readFileSync(STAR_HISTORY_PATH, 'utf8'));
    return Array.isArray(data.points) ? data : { repository: REPOSITORY, points: [] };
  } catch {
    return { repository: REPOSITORY, points: [] };
  }
}

function updateStarHistory() {
  const starsArgument = process.argv.indexOf('--stars');
  const starCount = starsArgument >= 0 ? Number(process.argv[starsArgument + 1]) : Number.NaN;
  const history = readStarHistory();
  const today = dateKey(new Date());

  if (Number.isInteger(starCount) && starCount >= 0) {
    history.points = history.points.filter((point) => point.date !== today);
    history.points.push({ date: today, stars: starCount });
  }

  history.repository = REPOSITORY;
  history.points = history.points
    .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isInteger(point.stars) && point.stars >= 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  writeFileSync(STAR_HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`);
  return history.points;
}

function renderStarHistory(points) {
  const width = 760;
  const height = 220;
  const padding = { top: 34, right: 26, bottom: 40, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const lastPoint = points.at(-1);
  const values = points.map((point) => point.stars);
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const range = Math.max(1, maximum - minimum);
  const firstDate = points.length ? dateFromKey(points[0].date) : startOfUtcDay(new Date());
  const lastDate = points.length ? dateFromKey(lastPoint.date) : firstDate;
  const days = Math.max(1, Math.round((lastDate - firstDate) / DAY_MS));
  const coordinates = points.map((point) => {
    const x = padding.left + ((dateFromKey(point.date) - firstDate) / DAY_MS / days) * plotWidth;
    const y = padding.top + plotHeight - ((point.stars - minimum) / range) * plotHeight;
    return { x, y, ...point };
  });
  const polyline = coordinates.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const series = coordinates.length > 1
    ? `<polyline points="${polyline}" fill="none" stroke="#0969da" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
    : '';
  const labels = lastPoint
    ? `起点 ${escapeXml(points[0].date)} · 当前 ${lastPoint.stars} Stars · 更新 ${escapeXml(lastPoint.date)}`
    : '等待首次 Star 数据更新';
  const dots = coordinates.map(({ x, y, date, stars }) =>
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#0969da"><title>${escapeXml(`${date}: ${stars} Stars`)}</title></circle>`,
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(labels)}">
  <rect width="100%" height="100%" rx="8" fill="#ffffff" stroke="#d0d7de"/>
  <text x="${padding.left}" y="22" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="14" font-weight="600" fill="#24292f">⭐ Star 趋势</text>
  <text x="${padding.left}" y="${height - 14}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="11" fill="#57606a">${labels}</text>
  <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="#d0d7de"/>
  <text x="10" y="${padding.top + 4}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="11" fill="#57606a">${maximum}</text>
  <text x="10" y="${padding.top + plotHeight}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="11" fill="#57606a">${minimum}</text>
${series}
  ${dots}
</svg>
`;
}

function activityDate(date) {
  return new Date(date.getTime() + BEIJING_OFFSET_MS);
}

function activityDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function startOfActivityBucket(date) {
  const local = activityDate(date);
  return new Date(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    Math.floor(local.getUTCHours() / ACTIVITY_BUCKET_HOURS) * ACTIVITY_BUCKET_HOURS,
  ));
}

function activityBucketKey(bucket) {
  return `${activityDateKey(bucket)}T${String(bucket.getUTCHours()).padStart(2, '0')}`;
}

function activityBucketKeyForCommit(date) {
  return activityBucketKey(startOfActivityBucket(date));
}

function formatActivityBucket(bucket) {
  const startHour = bucket.getUTCHours();
  const endHour = (startHour + ACTIVITY_BUCKET_HOURS) % 24;
  return `${activityDateKey(bucket)} ${String(startHour).padStart(2, '0')}:00–${String(endHour).padStart(2, '0')}:00 GMT+8`;
}

function commitCounts() {
  const output = execFileSync('git', ['log', '--format=%cI', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' });
  return output.trim().split('\n').filter(Boolean).reduce((counts, timestamp) => {
    const key = activityBucketKeyForCommit(new Date(timestamp));
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map());
}

function renderCommitActivity(counts) {
  const slotsPerDay = 24 / ACTIVITY_BUCKET_HOURS;
  const latestBucket = startOfActivityBucket(new Date());
  const latestDay = new Date(Date.UTC(
    latestBucket.getUTCFullYear(),
    latestBucket.getUTCMonth(),
    latestBucket.getUTCDate(),
  ));
  const start = new Date(latestDay.getTime() - (ACTIVITY_DAYS - 1) * DAY_MS);
  const cell = 20;
  const gap = 5;
  const left = 78;
  const top = 46;
  const width = left + slotsPerDay * (cell + gap) + 20;
  const height = top + ACTIVITY_DAYS * (cell + gap) + 30;
  const maximum = Math.max(1, ...counts.values());
  const cells = [];
  const timeLabels = [];
  const dateLabels = [];

  for (let slot = 0; slot < slotsPerDay; slot += 1) {
    const hour = slot * ACTIVITY_BUCKET_HOURS;
    const x = left + slot * (cell + gap) + cell / 2;
    timeLabels.push(`<text x="${x}" y="${top - 12}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="10" fill="#57606a">${String(hour).padStart(2, '0')}</text>`);
  }

  for (let day = 0; day < ACTIVITY_DAYS; day += 1) {
    const dayStart = new Date(start.getTime() + day * 24 * HOUR_MS);
    const y = top + day * (cell + gap) + cell / 2 + 4;
    dateLabels.push(`<text x="${left - 9}" y="${y}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="10" fill="#57606a">${activityDateKey(dayStart).slice(5)}</text>`);

    for (let slot = 0; slot < slotsPerDay; slot += 1) {
      const bucket = new Date(dayStart.getTime() + slot * ACTIVITY_BUCKET_HOURS * HOUR_MS);
      const count = counts.get(activityBucketKey(bucket)) ?? 0;
      const level = count === 0 ? 0 : Math.min(4, Math.ceil((count / maximum) * 4));
      const x = left + slot * (cell + gap);
      const rectY = top + day * (cell + gap);
      cells.push(`<rect x="${x}" y="${rectY}" width="${cell}" height="${cell}" rx="3" fill="${COMMIT_COLORS[level]}"><title>${formatActivityBucket(bucket)}: ${count} commits</title></rect>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="本仓库最近 7 天按北京时间每两小时统计的提交活跃度">
  <rect width="100%" height="100%" rx="8" fill="#ffffff" stroke="#d0d7de"/>
  <text x="${left}" y="22" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="14" font-weight="600" fill="#24292f">🟩 提交活跃度（最近 7 天 · 每格 2 小时）</text>
  <text x="${left}" y="36" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="10" fill="#57606a">北京时间（GMT+8）</text>
  ${timeLabels.join('')}
  ${dateLabels.join('')}
  ${cells.join('')}
</svg>
`;
}

mkdirSync(ASSETS_DIR, { recursive: true });
const points = updateStarHistory();
writeFileSync(STAR_SVG_PATH, renderStarHistory(points));
writeFileSync(COMMIT_SVG_PATH, renderCommitActivity(commitCounts()));
