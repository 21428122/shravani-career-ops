#!/usr/bin/env node
/**
 * daily-update.mjs
 *
 * 1. Runs the portal scan (scan.mjs in parent testing folder).
 * 2. Parses data/pipeline.md and classifies each queued job into a niche.
 * 3. Generates a tailored PDF per company from templates/resume-template.html + niches.json.
 * 4. Rebuilds INDEX.md with apply links.
 * 5. git add / commit / push to the GitHub repo.
 *
 * Designed to be run daily at 7 AM ET via Windows Task Scheduler.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TESTING = resolve(ROOT, '..');
const PDFS_DIR = join(ROOT, 'pdfs');
const HTML_DIR = join(ROOT, 'html');
const TEMPLATE_PATH = join(ROOT, 'templates', 'resume-template.html');
const NICHES_PATH = join(ROOT, 'templates', 'niches.json');
const PIPELINE_PATH = join(TESTING, 'data', 'pipeline.md');
const INDEX_PATH = join(ROOT, 'INDEX.md');
const LOG_PATH = join(ROOT, 'daily-log.txt');

mkdirSync(PDFS_DIR, { recursive: true });
mkdirSync(HTML_DIR, { recursive: true });

function log(msg) {
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${msg}`;
  console.log(line);
  try { writeFileSync(LOG_PATH, line + '\n', { flag: 'a' }); } catch {}
}

function slugify(s) {
  return s.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 30);
}

function datestampYYYYMM() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function classifyNiche(company, title, niches) {
  const text = (company + ' ' + title).toLowerCase();
  for (const [name, cfg] of Object.entries(niches)) {
    if (name === 'generic') continue;
    for (const kw of cfg.keywords) {
      if (text.includes(kw.toLowerCase())) return name;
    }
  }
  return 'generic';
}

function parsePipeline(content) {
  const entries = [];
  const seen = new Set();
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    const m = line.match(/^- \[ \]\s+(\S+)(?:\s*\|\s*([^|]+?))?(?:\s*\|\s*(.+?))?\s*$/);
    if (!m) continue;
    const url = m[1];
    const company = (m[2] || 'Unknown').trim();
    const dedupKey = `${url}|${company.toLowerCase()}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    entries.push({
      url,
      company,
      title: (m[3] || 'Product Role').trim(),
    });
  }
  return entries;
}

function run() {
  log('=== Daily update started ===');

  // 1. Run scan
  try {
    log('Running scan.mjs…');
    execSync('node scan.mjs', { cwd: TESTING, stdio: 'inherit' });
  } catch (e) {
    log(`scan.mjs failed: ${e.message}`);
  }

  // 2. Parse pipeline
  if (!existsSync(PIPELINE_PATH)) {
    log('No pipeline.md found — aborting');
    return;
  }
  const entries = parsePipeline(readFileSync(PIPELINE_PATH, 'utf-8'));
  log(`Found ${entries.length} queued applications`);

  // 3. Load niche config + template
  const niches = JSON.parse(readFileSync(NICHES_PATH, 'utf-8'));
  const template = readFileSync(TEMPLATE_PATH, 'utf-8');
  const stamp = datestampYYYYMM();

  // 4. Generate PDFs
  const results = [];
  for (const entry of entries) {
    const niche = classifyNiche(entry.company, entry.title, niches);
    const nicheCfg = niches[niche];
    const companySlug = slugify(entry.company);
    const filename = `ShravaniDorlikar-PMIntern-${companySlug}-${stamp}.pdf`;
    const pdfPath = join(PDFS_DIR, filename);

    results.push({ ...entry, niche, filename });

    if (existsSync(pdfPath)) {
      log(`Skip (exists): ${filename}`);
      continue;
    }

    // Build headline + skills
    const headline = nicheCfg.headline
      .replace('{{ROLE}}', entry.title)
      .replace('{{COMPANY}}', entry.company);
    const skillsHtml = nicheCfg.skills
      .map(s => `<p><span class="label">${s.label}:</span> ${s.items}</p>`)
      .join('\n    ');
    const html = template
      .replace('{{HEADLINE}}', headline)
      .replace('{{SKILLS}}', skillsHtml);

    const htmlPath = join(HTML_DIR, `${companySlug}.html`);
    writeFileSync(htmlPath, html, 'utf-8');

    // Generate PDF via generate-pdf.mjs in parent
    try {
      log(`Generating PDF: ${filename} (niche=${niche})`);
      execSync(
        `node generate-pdf.mjs "${htmlPath}" "${pdfPath}" --format=letter`,
        { cwd: TESTING, stdio: 'pipe' }
      );
    } catch (e) {
      log(`PDF failed for ${entry.company}: ${e.message}`);
    }
  }

  // 5. Build INDEX.md
  const nowET = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  let idx = `# Shravani's PM Internship Resume Pipeline\n\n`;
  idx += `_Auto-refreshed every day at 7:00 AM ET._\n`;
  idx += `_Last update: **${nowET}**_\n\n`;
  idx += `Total active applications: **${results.length}**\n\n`;

  const byNiche = {};
  for (const r of results) (byNiche[r.niche] = byNiche[r.niche] || []).push(r);

  idx += `## By niche\n\n`;
  for (const [niche, list] of Object.entries(byNiche).sort()) {
    idx += `- **${niche}** — ${list.length}\n`;
  }
  idx += `\n## All applications\n\n`;
  idx += `| # | Company | Role | Niche | Tailored Resume | Apply |\n`;
  idx += `|---|---------|------|-------|-----------------|-------|\n`;
  results.forEach((r, i) => {
    idx += `| ${i + 1} | ${r.company} | ${r.title} | \`${r.niche}\` | [PDF](pdfs/${r.filename}) | [→ Apply](${r.url}) |\n`;
  });
  idx += `\n---\n\n`;
  idx += `## How this works\n\n`;
  idx += `- **Scanner** (\`../scan.mjs\` in the Career-Ops install) polls Greenhouse / Ashby / Lever APIs for new PM-intern-friendly roles every day.\n`;
  idx += `- **Classifier** matches each posting to a niche from \`templates/niches.json\` based on company + title keywords.\n`;
  idx += `- **Generator** fills \`templates/resume-template.html\` with niche-specific headline + skills and compiles a PDF via Playwright.\n`;
  idx += `- **This repo** holds every tailored PDF so you can grab the right one for each application.\n`;
  writeFileSync(INDEX_PATH, idx, 'utf-8');

  // 6. Commit + push
  try {
    execSync('git add -A', { cwd: ROOT, stdio: 'pipe' });
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf-8' });
    if (!status.trim()) {
      log('No git changes to commit');
    } else {
      const date = new Date().toISOString().slice(0, 10);
      execSync(
        `git commit -m "Daily refresh ${date}: ${results.length} applications tracked"`,
        { cwd: ROOT, stdio: 'pipe' }
      );
      execSync('git push origin main', { cwd: ROOT, stdio: 'pipe' });
      log(`✅ Pushed ${results.length} applications to GitHub`);
    }
  } catch (e) {
    log(`git push failed: ${e.message}`);
  }

  log('=== Daily update complete ===\n');
}

run();
