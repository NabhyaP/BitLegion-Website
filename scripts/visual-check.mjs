import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.VISUAL_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDir = fileURLToPath(new URL('../test-results/', import.meta.url));
await mkdir(outputDir, { recursive: true });

const now = Date.now();
const day = 86_400_000;
const me = {
  id: 1,
  displayName: 'Aarav Sharma',
  collegeEmail: '112415119@cse.iiitp.ac.in',
  rollNo: '112415119',
  batchYear: 2024,
  branch: 'CSE',
  status: 'ACTIVE',
  showInLeaderboard: true,
  avatarUrl: null,
  profileConfirmed: true,
  roles: ['MEMBER'],
  codeforces: {
    handle: 'aarav_cf',
    status: 'ACTIVE',
    verifiedAt: new Date(now - day).toISOString(),
    solvedCount: 128,
    lastSyncedAt: new Date(now - day).toISOString(),
  },
};

const leaderboardEntries = [
  ['Aarav Sharma', 'aarav_cf', 2024, 'CSE', 1684, 1780, 128],
  ['Mira Patel', 'mira_codes', 2025, 'ECE', 1542, 1610, 96],
  ['Kabir Verma', 'kv_algo', 2023, 'CSE', 1430, 1512, 112],
  ['Isha Nair', 'isha_n', 2024, 'ECE', 1328, 1450, 84],
].map(([displayName, handle, batch, branch, rating, maxRating, solvedCount], index) => ({
  rank: index + 1,
  userId: index + 1,
  displayName,
  handle,
  batch,
  branch,
  rating,
  maxRating,
  codeforcesRank: 'expert',
  ratingChange30d: [64, 21, -18, 45][index],
  solvedCount,
  avatarUrl: null,
  profileUpdatedAt: new Date(now - 15 * 60_000).toISOString(),
  stale: false,
}));

const trendDates = Array.from({ length: 12 }, (_, index) =>
  new Date(now - (11 - index) * 30 * day).toISOString().slice(0, 10));
const trendSeries = [
  { batchYear: null, label: 'Overall', start: 1210, step: 18 },
  { batchYear: 2025, label: '2025', start: 1080, step: 23 },
  { batchYear: 2024, label: '2024', start: 1260, step: 20 },
  { batchYear: 2023, label: '2023', start: 1380, step: 12 },
].map(({ batchYear, label, start, step }) => ({
  batchYear,
  label,
  points: trendDates.map((date, index) => ({
    date,
    average: start + index * step,
    median: start - 25 + index * (step + 1),
    memberCount: 18 + index,
  })),
}));

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installMocks(page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/me') return json(route, { data: me });
    if (url.pathname === '/api/v1/settings/public') {
      return json(route, { data: { announcement: '', leaderboardEnabled: true } });
    }
    if (url.pathname === '/api/v1/auth/csrf-token') return json(route, { csrfToken: 'visual-token' });
    if (url.pathname === '/api/v1/course-codes') {
      return json(route, { data: [
        { code: '15', branch: 'CSE', name: 'Computer Science and Engineering' },
        { code: '16', branch: 'ECE', name: 'Electronics and Communication Engineering' },
      ] });
    }
    if (url.pathname.endsWith('/trends')) {
      return json(route, { data: trendSeries, meta: { generatedAt: new Date(now).toISOString(), days: 365 } });
    }
    if (url.pathname.endsWith('/me-comparison')) {
      return json(route, {
        available: true,
        generatedAt: new Date(now).toISOString(),
        handle: 'aarav_cf',
        rating: 1684,
        overall: { rank: 1, total: 42, percentile: 100, average: 1312.4, median: 1290, differenceFromAverage: 371.6 },
        cohort: { batchYear: 2024, rank: 1, total: 12, percentile: 100, average: 1388.5, median: 1402, differenceFromAverage: 295.5 },
      });
    }
    if (url.pathname === '/api/v1/leaderboards/codeforces') {
      return json(route, {
        data: leaderboardEntries,
        meta: {
          snapshotId: 9,
          generatedAt: new Date(now - 15 * 60_000).toISOString(),
          nextRefreshAfter: new Date(now + 45 * 60_000).toISOString(),
          scope: 'all',
          limit: 50,
          nextCursor: null,
        },
      });
    }
    return json(route, { error: { code: 'NOT_FOUND', message: 'No visual fixture.' } }, 404);
  });

  await page.route('https://codeforces.com/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/contest.list')) {
      return json(route, { status: 'OK', result: [
        { id: 2201, name: 'Codeforces Round 1050 (Div. 2)', phase: 'BEFORE', type: 'CF', durationSeconds: 7200, startTimeSeconds: Math.floor((now + 2 * day) / 1000) },
        { id: 2202, name: 'Educational Codeforces Round 190', phase: 'BEFORE', type: 'ICPC', durationSeconds: 7200, startTimeSeconds: Math.floor((now + 5 * day) / 1000) },
        { id: 2203, name: 'Codeforces Round 1051 (Div. 1 + Div. 2)', phase: 'BEFORE', type: 'CF', durationSeconds: 9000, startTimeSeconds: Math.floor((now + 8 * day) / 1000) },
      ] });
    }
    if (url.pathname.endsWith('/user.info')) {
      return json(route, { status: 'OK', result: [{ handle: 'aarav_cf', rating: 1684, maxRating: 1780, rank: 'expert', maxRank: 'expert', contribution: 12 }] });
    }
    if (url.pathname.endsWith('/user.rating')) {
      return json(route, { status: 'OK', result: Array.from({ length: 8 }, (_, index) => ({
        contestId: 2000 + index,
        contestName: `Round ${index + 1}`,
        handle: 'aarav_cf',
        rank: 500 - index * 30,
        ratingUpdateTimeSeconds: Math.floor((now - (8 - index) * 20 * day) / 1000),
        oldRating: 1350 + index * 45,
        newRating: 1395 + index * 41,
      })) });
    }
    if (url.pathname.endsWith('/user.status')) {
      return json(route, { status: 'OK', result: Array.from({ length: 24 }, (_, index) => ({
        id: 9000 + index,
        creationTimeSeconds: Math.floor((now - index * day) / 1000),
        problem: { contestId: 2100 + index, index: 'A', name: `Practice Problem ${index + 1}`, rating: 800 + (index % 6) * 200, tags: [index % 2 ? 'graphs' : 'implementation'] },
        verdict: index % 5 === 0 ? 'WRONG_ANSWER' : 'OK',
        programmingLanguage: index % 3 === 0 ? 'Python 3' : 'GNU C++20',
      })) });
    }
    return json(route, { status: 'FAILED', comment: 'No visual fixture.' });
  });
}

async function assertViewport(page, name) {
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    offenders: [...document.querySelectorAll('*')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, className: element.className, left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((rect) => rect.left < -1 || rect.right > window.innerWidth + 1)
      .slice(0, 8),
  }));
  assert.ok(result.overflow <= 1, `${name} has ${result.overflow}px horizontal overflow: ${JSON.stringify(result.offenders)}`);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => sessionStorage.setItem('introPlayed', '1'));
    await installMocks(page);

    await page.goto(`${baseUrl}/leaderboard`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Cohort Rating Trends' }).waitFor();
    await page.waitForTimeout(700);
    const paintedPixels = await page.locator('canvas').evaluate((canvas) => {
      const context2d = canvas.getContext('2d');
      if (!context2d) return 0;
      const pixels = context2d.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 0) painted++;
      }
      return painted;
    });
    assert.ok(paintedPixels > 100, `trend chart is blank at ${viewport.name}`);
    const cfProfileHref = await page.getByRole('link', { name: 'Open aarav_cf on Codeforces' }).getAttribute('href');
    assert.equal(cfProfileHref, 'https://codeforces.com/profile/aarav_cf');
    await assertViewport(page, `leaderboard ${viewport.name}`);
    await page.screenshot({ path: path.join(outputDir, `leaderboard-${viewport.name}.png`), fullPage: true });

    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Upcoming Codeforces Contests' }).waitFor();
    await page.getByText('Codeforces Round 1050 (Div. 2)').waitFor({ timeout: 20_000 });
    await page.getByText('Current Rating').waitFor({ timeout: 20_000 });
    await page.getByRole('region', { name: 'Codeforces stats summary' })
      .getByText('19', { exact: true })
      .waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Open account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).waitFor();
    const myProfileHref = await page.getByRole('menuitem', { name: 'My profile' }).getAttribute('href');
    assert.equal(myProfileHref, '/profile/aarav_cf');
    await assertViewport(page, `dashboard ${viewport.name}`);
    await page.screenshot({ path: path.join(outputDir, `dashboard-${viewport.name}.png`), fullPage: true });

    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Open account menu' }).click();
    await page.getByRole('menuitem', { name: 'My profile' }).waitFor();
    await page.getByRole('menuitem', { name: 'Sign out' }).waitFor();
    await assertViewport(page, `home ${viewport.name}`);
    await page.screenshot({ path: path.join(outputDir, `home-${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, [], `${viewport.name} page errors: ${errors.join('; ')}`);
    await context.close();
  }
} finally {
  await browser.close();
}

console.log('visual checks passed: leaderboard/dashboard/home desktop + mobile, account menu, links, and nonblank trend canvas');
